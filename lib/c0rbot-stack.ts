import * as path from "path";
import { createRequire } from "module";
import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

// Resolve the SOPS-decrypted environment.js (run `npm run decrypt` first).
// It exports environment() -> { environment: "<json string>" }, the single
// `environment` env var every handler parses at runtime.
const require_ = createRequire(__filename);
function loadEnvironment(): { environment: string } {
  const envPath = path.join(__dirname, "..", "environment.js");
  try {
    return require_(envPath).environment();
  } catch (err) {
    throw new Error(
      `Could not load ${envPath}. Run "npm run decrypt" to produce it from ` +
        `environment.js.enc before synth/deploy. Original error: ${
          (err as Error).message
        }`,
    );
  }
}

// New clean table names (the `-dev` stage suffix is dropped on the two that
// had it). These are the 6 tables defined in the old serverless.yml resources.
const TABLE = {
  feeds: "feeds", // was feeds-dev
  dotaPlayers: "dota-players", // was dota-players-dev
  fortnite: "fortnite",
  matches: "matches",
  config: "config",
  cache: "cache",
} as const;

const SERVICE = "c0rbot";
const fn = (name: string) => `${SERVICE}-${name}`;

interface ScheduleDef {
  rate: Duration;
  enabled: boolean;
}

interface FunctionDef {
  name: string; // short name -> c0rbot-<name>
  handler: string; // copied verbatim from serverless.yml
  table?: string; // primary table -> process.env.table
  timeoutSeconds?: number; // default 30
  schedule?: ScheduleDef;
  url?: boolean;
}

// Mirrors serverless.yml functions 1:1 (rates, enabled flags, timeouts, tables).
const FUNCTIONS: FunctionDef[] = [
  {
    name: "redditFeed",
    handler: "handler.redditFeed",
    table: TABLE.feeds,
    schedule: { rate: Duration.minutes(5), enabled: false },
  },
  {
    name: "dotaBlog",
    handler: "handler.dotaBlog",
    table: TABLE.feeds,
    schedule: { rate: Duration.minutes(5), enabled: false },
  },
  {
    name: "pokemongoUpdates",
    handler: "handler.pokemongoUpdates",
    table: TABLE.feeds,
    schedule: { rate: Duration.minutes(30), enabled: false },
  },
  {
    name: "twitchStreams",
    handler: "handler.twitchStreams",
    table: TABLE.feeds,
    schedule: { rate: Duration.minutes(5), enabled: false },
  },
  {
    name: "arkChangelog",
    handler: "handler.arkChangelog",
    table: TABLE.feeds,
    schedule: { rate: Duration.minutes(30), enabled: false },
  },
  {
    name: "dotaMatches",
    handler: "handler.dotaMatches",
    table: TABLE.dotaPlayers,
  },
  {
    name: "openDotaMatches",
    handler: "handler.openDotaMatches",
    table: TABLE.dotaPlayers,
    schedule: { rate: Duration.minutes(10), enabled: true },
  },
  {
    name: "dotaUpdates",
    handler: "handler.dotaUpdates",
    table: TABLE.feeds,
    schedule: { rate: Duration.minutes(5), enabled: false },
  },
  {
    name: "steamUpdates",
    handler: "handlers/SteamUpdates.handler",
    table: TABLE.feeds,
    schedule: { rate: Duration.hours(1), enabled: true },
  },
  {
    name: "fortniteMatches",
    handler: "handler.fortniteMatches",
    table: TABLE.fortnite,
    schedule: { rate: Duration.minutes(15), enabled: false },
  },
  {
    name: "fortniteChangelog",
    handler: "handler.fortniteChangelog",
    table: TABLE.feeds,
    schedule: { rate: Duration.minutes(30), enabled: false },
  },
  {
    name: "pubgMatches",
    handler: "handler.pubgMatches",
    table: "pubg",
    timeoutSeconds: 300,
    schedule: { rate: Duration.minutes(5), enabled: false },
  },
  {
    name: "underlordsChangelog",
    handler: "handler.underlordsChangelog",
    table: TABLE.feeds,
    schedule: { rate: Duration.minutes(30), enabled: false },
  },
  {
    name: "valheimPatches",
    handler: "handlers/valheim.handler",
    table: TABLE.feeds,
    schedule: { rate: Duration.hours(1), enabled: true },
  },
  {
    name: "noMansSkyPatches",
    handler: "handlers/NoMansSky.handler",
    table: TABLE.feeds,
    schedule: { rate: Duration.hours(1), enabled: true },
  },
  {
    name: "loopHeroPatches",
    handler: "handlers/LoopHero.handler",
    table: TABLE.feeds,
    schedule: { rate: Duration.hours(1), enabled: false },
  },
  {
    name: "deadlockMatches",
    handler: "handlers/DeadlockMatches.handler",
    timeoutSeconds: 60,
    schedule: { rate: Duration.minutes(30), enabled: true },
  },
  {
    name: "deadlockPatches",
    handler: "handlers/DeadlockPatches.handler",
    table: TABLE.feeds,
    schedule: { rate: Duration.hours(1), enabled: true },
  },
  {
    name: "dotaNews",
    handler: "handlers/DotaNews.handler",
    table: TABLE.feeds,
    schedule: { rate: Duration.hours(1), enabled: true },
  },
  {
    name: "discordWebhookHandler",
    handler: "handlers/DiscordWebhookHandler.handler",
    url: true,
  },
  {
    name: "dotaAnalyst",
    handler: "handlers/DotaAnalyst.handler",
    timeoutSeconds: 180,
  },
  {
    name: "deadlockAnalyst",
    handler: "handlers/DeadlockAnalyst.handler",
    timeoutSeconds: 240,
  },
  { name: "embedTest", handler: "handler.embedTest" },
];

export class C0rbotStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const baseEnvironment = loadEnvironment();

    // --- DynamoDB tables (provisioned, RETAIN so data is never auto-deleted) ---
    const feedsTable = this.makeTable(
      "FeedsTable",
      TABLE.feeds,
      "name",
      undefined,
      5,
      5,
    );
    const dotaPlayersTable = this.makeTable(
      "DotaPlayersTable",
      TABLE.dotaPlayers,
      "steamID",
      undefined,
      5,
      5,
    );
    const fortniteTable = this.makeTable(
      "FortniteTable",
      TABLE.fortnite,
      "name",
      undefined,
      1,
      1,
    );
    const matchesTable = this.makeTable(
      "MatchesTable",
      TABLE.matches,
      "player_id",
      "game",
      5,
      5,
    );
    const configTable = this.makeTable(
      "ConfigTable",
      TABLE.config,
      "Key",
      "ConfigScope",
      1,
      1,
    );
    const cacheTable = this.makeTable(
      "CacheTable",
      TABLE.cache,
      "namespace",
      "key",
      5,
      5,
    );

    const allTables = [
      feedsTable,
      dotaPlayersTable,
      fortniteTable,
      matchesTable,
      configTable,
      cacheTable,
    ];

    // Deterministic ARNs for cross-references (avoids construct dependency cycles).
    const dotaAnalystArn = this.fnArn(fn("dotaAnalyst"));
    const deadlockAnalystArn = this.fnArn(fn("deadlockAnalyst"));
    const schedulerRoleName = fn("scheduler-role");
    const schedulerRoleArn = `arn:aws:iam::${this.account}:role/${schedulerRoleName}`;

    // --- EventBridge Scheduler role: lets the scheduler invoke dotaAnalyst (retry path) ---
    const schedulerRole = new iam.Role(this, "EventBridgeSchedulerRole", {
      roleName: schedulerRoleName,
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      inlinePolicies: {
        InvokeLambdaPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["lambda:InvokeFunction"],
              resources: [dotaAnalystArn],
            }),
          ],
        }),
      },
    });

    // --- Shared Lambda execution role (mirrors the single serverless provider role) ---
    const execRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });
    for (const table of allTables) {
      table.grantReadWriteData(execRole);
    }
    execRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [
          dotaAnalystArn,
          `${dotaAnalystArn}:*`,
          deadlockAnalystArn,
          `${deadlockAnalystArn}:*`,
        ],
      }),
    );
    execRole.addToPolicy(
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
    execRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerRoleArn],
      }),
    );

    // Shared deployment asset: zip the whole project (incl. node_modules), like
    // serverless v3. No esbuild, so the mixed .js/.mjs handlers run untouched.
    const code = lambda.Code.fromAsset(path.join(__dirname, ".."), {
      exclude: [
        "cdk.out",
        ".git",
        "llm-evals",
        "*.enc",
        ".devcontainer",
        "node_modules/.cache",
        "bin",
        "lib/c0rbot-stack.ts",
        "*.d.ts",
        "tsconfig.json",
        "cdk.json",
        // Dev-only tooling — keep it out of the Lambda package (size limit).
        "node_modules/.bin",
        "node_modules/aws-cdk",
        "node_modules/aws-cdk-lib",
        "node_modules/constructs",
        "node_modules/typescript",
        "node_modules/ts-node",
        "node_modules/@types",
        "node_modules/serverless",
        "node_modules/prettier",
        "serverless.yml",
      ],
    });

    // Table names every handler may reach for via lib/tables.js.
    const tableEnv: Record<string, string> = {
      CACHE_TABLE: cacheTable.tableName,
      CONFIG_TABLE: configTable.tableName,
      MATCHES_TABLE: matchesTable.tableName,
    };

    for (const def of FUNCTIONS) {
      const environment: Record<string, string> = {
        ...baseEnvironment,
        ...tableEnv,
      };
      if (def.table) environment.table = def.table;
      if (def.name === "discordWebhookHandler") {
        environment.DOTA_ANALYST_FN = fn("dotaAnalyst");
        environment.DEADLOCK_ANALYST_FN = fn("deadlockAnalyst");
      }
      if (def.name === "dotaAnalyst") {
        environment.SCHEDULER_ROLE_ARN = schedulerRoleArn;
      }

      const lambdaFn = new lambda.Function(this, `${def.name}Function`, {
        functionName: fn(def.name),
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: def.handler,
        code,
        role: execRole,
        timeout: Duration.seconds(def.timeoutSeconds ?? 30),
        environment,
      });

      if (def.schedule) {
        new events.Rule(this, `${def.name}Schedule`, {
          schedule: events.Schedule.rate(def.schedule.rate),
          enabled: def.schedule.enabled,
          targets: [new targets.LambdaFunction(lambdaFn)],
        });
      }

      if (def.url) {
        const url = lambdaFn.addFunctionUrl({
          authType: lambda.FunctionUrlAuthType.NONE,
        });
        new CfnOutput(this, `${def.name}Url`, { value: url.url });
      }
    }
  }

  private makeTable(
    id: string,
    tableName: string,
    hashKey: string,
    rangeKey: string | undefined,
    rcu: number,
    wcu: number,
  ): dynamodb.Table {
    return new dynamodb.Table(this, id, {
      tableName,
      partitionKey: { name: hashKey, type: dynamodb.AttributeType.STRING },
      ...(rangeKey
        ? { sortKey: { name: rangeKey, type: dynamodb.AttributeType.STRING } }
        : {}),
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: rcu,
      writeCapacity: wcu,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  private fnArn(functionName: string): string {
    return `arn:aws:lambda:${this.region}:${this.account}:function:${functionName}`;
  }
}
