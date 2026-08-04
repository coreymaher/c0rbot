import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const client = new SSMClient({});

async function fetchSecrets() {
  const name = process.env.SECRETS_PARAMETER;
  if (!name) {
    throw new Error("Missing required environment variable: SECRETS_PARAMETER");
  }

  const result = await client.send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );

  return JSON.parse(result.Parameter.Value);
}

// No reset on failure: every caller awaits this at module scope, so a rejection fails init
// and the execution environment is discarded rather than reused.
let pending;

export default () => (pending ??= fetchSecrets());
