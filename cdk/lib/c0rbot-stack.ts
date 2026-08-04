import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// These two tables carry a `-dev` suffix the others do not. Renaming a DynamoDB
// table means recreating it and migrating the data, so the names stay as they are.
const FEEDS_TABLE = "feeds-dev";
const DOTA_PLAYERS_TABLE = "dota-players-dev";

// One SecureString holding the config blob that used to be spread onto every function as
// plaintext -- and therefore published in the template and the bootstrap assets bucket.
// Deliberately not a CDK resource: managing the value here would put it back in the
// template. `npm run secrets:push` writes it; this stack only references the name.
const SECRETS_PARAMETER = "/c0rbot/environment";

interface FunctionOptions {
  /** Path relative to the repo root. */
  entry: string;
  /** Seconds. Defaults to 30. */
  timeout?: number;
  env?: Record<string, string>;
}

export class C0rbotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    // Changing a table name or key schema here replaces the table, losing its contents.
    const str = (name: string): dynamodb.Attribute => ({
      name,
      type: dynamodb.AttributeType.STRING,
    });

    const table = (
      id: string,
      tableName: string,
      partitionKey: dynamodb.Attribute,
      capacity: number,
      opts: {
        sortKey?: dynamodb.Attribute;
        timeToLiveAttribute?: string;
      } = {},
    ) =>
      new dynamodb.Table(this, id, {
        tableName,
        partitionKey,
        billingMode: dynamodb.BillingMode.PROVISIONED,
        readCapacity: capacity,
        writeCapacity: capacity,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        ...opts,
      });

    const feeds = table("FeedsTable", FEEDS_TABLE, str("name"), 5);
    const dotaPlayers = table(
      "DotaPlayersTable",
      DOTA_PLAYERS_TABLE,
      str("steamID"),
      5,
    );
    const matches = table("MatchesTable", "matches", str("player_id"), 5, {
      sortKey: str("game"),
    });
    const config = table("ConfigTable", "config", str("Key"), 1, {
      sortKey: str("ConfigScope"),
    });
    const cache = table("CacheTable", "cache", str("namespace"), 5, {
      sortKey: str("key"),
      timeToLiveAttribute: "expires_at",
    });

    // Built from the role name rather than the Role object to avoid a cycle: the
    // role's policy needs the analyst ARN, and the analyst's env needs the role ARN.
    const schedulerRoleName = "c0rbot-scheduler-role";
    const schedulerRoleArn = `arn:aws:iam::${this.account}:role/${schedulerRoleName}`;

    const makeFunction = (name: string, opts: FunctionOptions) => {
      const fn = new NodejsFunction(this, name, {
        functionName: `c0rbot-${name}`,
        entry: path.join(REPO_ROOT, opts.entry),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        memorySize: 1024,
        // Declared, because the group Lambda creates implicitly is unmanaged and
        // never expires. The name is pinned: a generated one breaks `aws logs tail`.
        logGroup: new logs.LogGroup(this, `${name}LogGroup`, {
          logGroupName: `/aws/lambda/c0rbot-${name}`,
          retention: logs.RetentionDays.ONE_YEAR,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        }),
        timeout: cdk.Duration.seconds(opts.timeout ?? 30),
        environment: {
          SECRETS_PARAMETER,
          CACHE_TABLE: cache.tableName,
          CONFIG_TABLE: config.tableName,
          MATCHES_TABLE: matches.tableName,
          ...(opts.env ?? {}),
        },
        projectRoot: REPO_ROOT,
        depsLockFilePath: path.join(REPO_ROOT, "package-lock.json"),
        bundling: {
          externalModules: ["@aws-sdk/*"],
          // ESM so handlers can `await secrets()` at module scope. The banner is not
          // optional: bundled CommonJS (utils.js, Discord.js) keeps its `require` calls,
          // which esbuild turns into a shim that throws "Dynamic require of ... is not
          // supported" in ESM output unless a real `require` is in scope.
          format: OutputFormat.ESM,
          banner:
            "import{createRequire as ___cr}from'module';const require=___cr(import.meta.url);",
          target: "node24",
          minify: false,
          sourceMap: false,
        },
      });

      // Config is fetched at init rather than injected, so every function needs to read
      // the one parameter. kms:Decrypt is belt and braces: the aws/ssm key policy already
      // allows the account through SSM, but the grant costs nothing and removes a
      // dependency on that policy staying as it is.
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ssm:GetParameter"],
          resources: [
            `arn:aws:ssm:${this.region}:${this.account}:parameter${SECRETS_PARAMETER}`,
          ],
        }),
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["kms:Decrypt"],
          resources: ["*"],
          conditions: {
            StringEquals: {
              "kms:ViaService": `ssm.${this.region}.amazonaws.com`,
            },
          },
        }),
      );

      return fn;
    };

    const openDotaMatches = makeFunction("openDotaMatches", {
      entry: "handlers/OpenDotaMatches.mjs",
      env: { table: DOTA_PLAYERS_TABLE },
    });
    dotaPlayers.grantReadWriteData(openDotaMatches);
    config.grantReadWriteData(openDotaMatches);
    // Reached via a dynamic import in OpenDotaAPI.js, not a static require.
    cache.grantReadWriteData(openDotaMatches);

    const steamUpdates = makeFunction("steamUpdates", {
      entry: "handlers/SteamUpdates.mjs",
      env: { table: FEEDS_TABLE },
    });
    feeds.grantReadWriteData(steamUpdates);

    const noMansSkyPatches = makeFunction("noMansSkyPatches", {
      entry: "handlers/NoMansSky.mjs",
      env: { table: FEEDS_TABLE },
    });
    feeds.grantReadWriteData(noMansSkyPatches);

    const deadlockMatches = makeFunction("deadlockMatches", {
      entry: "handlers/DeadlockMatches.mjs",
      timeout: 60,
    });
    matches.grantReadWriteData(deadlockMatches);
    cache.grantReadWriteData(deadlockMatches);

    const dotaAnalyst = makeFunction("dotaAnalyst", {
      entry: "handlers/DotaAnalyst.mjs",
      timeout: 180,
      env: { SCHEDULER_ROLE_ARN: schedulerRoleArn },
    });
    cache.grantReadWriteData(dotaAnalyst);
    dotaAnalyst.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:GetSchedule",
        ],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/default/retry-*`,
        ],
      }),
    );
    dotaAnalyst.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerRoleArn],
      }),
    );

    const deadlockAnalyst = makeFunction("deadlockAnalyst", {
      entry: "handlers/DeadlockAnalyst.mjs",
      timeout: 240,
    });
    matches.grantReadWriteData(deadlockAnalyst);
    cache.grantReadWriteData(deadlockAnalyst);

    const schedulerRole = new iam.Role(this, "EventBridgeSchedulerRole", {
      roleName: schedulerRoleName,
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    schedulerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [dotaAnalyst.functionArn],
      }),
    );

    const discordWebhookHandler = makeFunction("discordWebhookHandler", {
      entry: "handlers/DiscordWebhookHandler.mjs",
      env: {
        DOTA_ANALYST_FUNCTION_NAME: dotaAnalyst.functionName,
        DEADLOCK_ANALYST_FUNCTION_NAME: deadlockAnalyst.functionName,
      },
    });
    dotaAnalyst.grantInvoke(discordWebhookHandler);
    deadlockAnalyst.grantInvoke(discordWebhookHandler);

    const functionUrl = discordWebhookHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    const schedule = (
      name: string,
      minutes: cdk.Duration,
      fn: lambda.IFunction,
    ) =>
      new events.Rule(this, `${name}Schedule`, {
        schedule: events.Schedule.rate(minutes),
        targets: [new targets.LambdaFunction(fn)],
      });

    schedule("openDotaMatches", cdk.Duration.minutes(10), openDotaMatches);
    schedule("steamUpdates", cdk.Duration.hours(1), steamUpdates);
    schedule("noMansSkyPatches", cdk.Duration.hours(1), noMansSkyPatches);
    schedule("deadlockMatches", cdk.Duration.minutes(30), deadlockMatches);

    new cdk.CfnOutput(this, "DiscordWebhookUrl", {
      value: functionUrl.url,
      description:
        "Set this as the Interactions Endpoint URL in the Discord developer portal",
    });
  }
}
