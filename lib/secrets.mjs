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

// Not reset on failure: callers await at module scope, so a rejection discards the sandbox.
let pending;

export default () => (pending ??= fetchSecrets());
