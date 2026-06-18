# Serverless Framework → AWS CDK migration

This repo's infrastructure moved from the Serverless Framework (`serverless.yml`,
service `reddit`, stage `dev`) to AWS CDK (TypeScript, stack `c0rbot`). Deployment
stays manual and secrets stay in SOPS.

## What changed

- **IaC:** `serverless.yml` → CDK app (`bin/c0rbot.ts`, `lib/c0rbot-stack.ts`).
- **Names:** `reddit-dev-*` → `c0rbot-*` (functions and the scheduler role).
- **Tables:** the `-dev` stage suffix is dropped on the two that had it; the rest keep
  their names:
  | old (serverless)   | new (CDK)         |
  | ------------------ | ----------------- |
  | `feeds-dev`        | `feeds`           |
  | `dota-players-dev` | `dota-players`    |
  | `fortnite`         | `fortnite`        |
  | `matches`          | `matches`         |
  | `config`           | `config`          |
  | `cache`            | `cache`           |
- **Table names in code:** the cross-cutting hardcoded literals now come from
  `lib/tables.js` (env vars injected by CDK). Each function's primary table is still the
  `table` env var, as before.
- **Hardcoded resource names:** `DiscordWebhookHandler` reads the analyst function names from
  `DOTA_ANALYST_FN` / `DEADLOCK_ANALYST_FN`; `DotaAnalyst` reads the scheduler role from
  `SCHEDULER_ROLE_ARN`. All injected by CDK.

> Note: `deadlock-players-dev` and `pubg` were referenced in `serverless.yml` env vars but are
> **not** real data tables in use — `deadlockMatches`/`deadlockAnalyst` store state in
> `matches` (game = "deadlock"), and `pubgMatches` is disabled. Neither is created by CDK.

## Day-to-day deploy

```bash
yarn install
yarn deploy        # = sops decrypt -> cdk deploy
# also: yarn synth (cdk synth), yarn diff (cdk diff)
```

`environment.js` is produced by `npm run decrypt` (SOPS + KMS, profile `c0rbot-admin`) and is
consumed by the CDK app at synth time, then injected as the single `environment` env var into
every function — exactly as before.

## One-time cutover (run once, downtime is fine)

Prereqs: SOPS + AWS CLI configured for profile `c0rbot-admin`, `yarn install` done.

```bash
export AWS_PROFILE=c0rbot-admin

# 1. Snapshot all live table data (safety net + migration source).
for t in feeds-dev dota-players-dev fortnite matches config cache; do
  node scripts/dynamo-export.mjs "$t"
  aws dynamodb create-backup --table-name "$t" \
      --backup-name "$t-presls-removal" --region us-east-1
done

# 2. Tear down the old Serverless stack (deletes old lambdas/schedules/URL/roles
#    AND the old tables). Downtime starts here.
npm run decrypt
npx serverless remove

# 3. Deploy the CDK stack (creates everything fresh, incl. empty new tables).
yarn deploy

# 4. Restore data into the new tables (note the rename mapping for the first two).
node scripts/dynamo-import.mjs feeds        feeds-dev.export.json
node scripts/dynamo-import.mjs dota-players dota-players-dev.export.json
node scripts/dynamo-import.mjs fortnite     fortnite.export.json
node scripts/dynamo-import.mjs matches      matches.export.json
node scripts/dynamo-import.mjs config       config.export.json
node scripts/dynamo-import.mjs cache        cache.export.json
```

5. **Re-register the Discord interactions endpoint.** The function URL hostname changes; grab
   the new one from the `cdk deploy` output (`discordWebhookHandlerUrl`) and set it as the
   "Interactions Endpoint URL" in the Discord developer portal.

6. **Verify** (see below), then clean up: delete the on-demand backups and the `*.export.json`
   files once you're confident.

### Verify

- Restored item counts match the export counts per table.
- `aws lambda invoke --function-name c0rbot-openDotaMatches /dev/stdout` runs cleanly and posts
  to Discord; check CloudWatch with `scripts/check-lambda-errors.sh`.
- A Discord button interaction reaches the new URL (Ed25519 verification passes) and invokes
  the analyst.
- The dotaAnalyst retry path creates an EventBridge schedule using `c0rbot-scheduler-role`.

## After the cutover

Once everything is confirmed on CDK, remove the Serverless leftovers:

- delete `serverless.yml`
- remove the `serverless` devDependency from `package.json`
