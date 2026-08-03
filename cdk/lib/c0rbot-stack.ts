import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Same secrets file serverless.yml read via `${file(environment.js):environment}`.
// It exports a function returning { environment: "<json string>" }, which is the
// single `environment` env var every handler JSON.parses. Requires `npm run decrypt`.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { environment } = require(path.join(REPO_ROOT, "environment.js"));

/** Matches the deployed serverless functions, which run at 1024MB (CDK defaults to 128). */
const MEMORY_SIZE = 1024;

// These two tables were created by the serverless stack with a `-dev` stage
// suffix. There is only one environment, so the suffix is vestigial -- but
// renaming a DynamoDB table means recreating it and migrating the data, so the
// legacy names stay. Everything else here is unsuffixed.
const FEEDS_TABLE = "feeds-dev";
const DOTA_PLAYERS_TABLE = "dota-players-dev";

export type C0rbotStackProps = cdk.StackProps;

interface FunctionOptions {
  /** Path relative to the repo root. */
  entry: string;
  /** Seconds. Serverless provider default was 30. */
  timeout?: number;
  env?: Record<string, string>;
}

export class C0rbotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: C0rbotStackProps) {
    super(scope, id, props);

    const secrets: Record<string, string> = environment();

    // Adopted from the deleted serverless stack via `cdk import`. These must
    // match the live tables exactly -- key schema, capacity and TTL -- or the
    // import is rejected. RETAIN so a future stack delete cannot destroy data.
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
    // TTL was enabled out-of-band, never declared in serverless.yml. Omitting it
    // here would make CDK try to disable it on the imported table.
    const cache = table("CacheTable", "cache", str("namespace"), 5, {
      sortKey: str("key"),
      timeToLiveAttribute: "expires_at",
    });
    // No live function uses this one, but it holds data and should stay managed.
    table("FortniteTable", "fortnite", str("name"), 1);

    // Built from the explicit role name rather than the Role object, to avoid a
    // cycle: the role's policy needs the analyst ARN, the analyst's env needs
    // the role ARN. serverless.yml resolved it the same way.
    const schedulerRoleName = "c0rbot-scheduler-role";
    const schedulerRoleArn = `arn:aws:iam::${this.account}:role/${schedulerRoleName}`;

    const makeFunction = (name: string, opts: FunctionOptions) =>
      new NodejsFunction(this, name, {
        functionName: `c0rbot-${name}`,
        entry: path.join(REPO_ROOT, opts.entry),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_22_X,
        memorySize: MEMORY_SIZE,
        timeout: cdk.Duration.seconds(opts.timeout ?? 30),
        environment: { ...secrets, ...(opts.env ?? {}) },
        projectRoot: REPO_ROOT,
        depsLockFilePath: path.join(REPO_ROOT, "yarn.lock"),
        bundling: {
          // The Node 22 runtime ships the v3 SDK; bundling it would add ~10MB.
          externalModules: ["@aws-sdk/*"],
          format: OutputFormat.CJS,
          target: "node22",
          minify: false,
          sourceMap: false,
        },
      });

    // --- Scheduled feed pollers -------------------------------------------

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

    const valheimPatches = makeFunction("valheimPatches", {
      entry: "handlers/valheim.js",
      env: { table: FEEDS_TABLE },
    });
    feeds.grantReadWriteData(valheimPatches);

    const noMansSkyPatches = makeFunction("noMansSkyPatches", {
      entry: "handlers/NoMansSky.js",
      env: { table: FEEDS_TABLE },
    });
    feeds.grantReadWriteData(noMansSkyPatches);

    const deadlockPatches = makeFunction("deadlockPatches", {
      entry: "handlers/DeadlockPatches.js",
      env: { table: FEEDS_TABLE },
    });
    feeds.grantReadWriteData(deadlockPatches);

    // No `table` env var: DeadlockMatches.mjs hardcodes TableName "matches" and
    // ignored the serverless `deadlock-players-dev` value, which pointed at a
    // table that does not exist.
    const deadlockMatches = makeFunction("deadlockMatches", {
      entry: "handlers/DeadlockMatches.mjs",
      timeout: 60,
    });
    matches.grantReadWriteData(deadlockMatches);
    cache.grantReadWriteData(deadlockMatches);

    // --- On-demand analysts, invoked by the webhook handler ---------------

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

    // Lets EventBridge Scheduler re-invoke the analyst for the 2-minute retry.
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

    // --- Discord interaction endpoint -------------------------------------

    const discordWebhookHandler = makeFunction("discordWebhookHandler", {
      entry: "handlers/DiscordWebhookHandler.mjs",
      env: {
        DOTA_ANALYST_FUNCTION_NAME: "c0rbot-dotaAnalyst",
        DEADLOCK_ANALYST_FUNCTION_NAME: "c0rbot-deadlockAnalyst",
      },
    });
    dotaAnalyst.grantInvoke(discordWebhookHandler);
    deadlockAnalyst.grantInvoke(discordWebhookHandler);

    const functionUrl = discordWebhookHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // --- Schedules --------------------------------------------------------

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
    schedule("valheimPatches", cdk.Duration.hours(1), valheimPatches);
    schedule("noMansSkyPatches", cdk.Duration.hours(1), noMansSkyPatches);
    schedule("deadlockPatches", cdk.Duration.hours(1), deadlockPatches);
    schedule("deadlockMatches", cdk.Duration.minutes(30), deadlockMatches);

    // --- Outputs ----------------------------------------------------------

    new cdk.CfnOutput(this, "DiscordWebhookUrl", {
      value: functionUrl.url,
      description:
        "Set this as the Interactions Endpoint URL in the Discord developer portal",
    });
  }
}
