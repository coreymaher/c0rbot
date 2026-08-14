// @ts-check

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

  const value = result.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${name} is empty`);
  }

  return JSON.parse(value);
}

// Not reset on failure: callers await at module scope, so a rejection discards the sandbox.
let pending;

export default () => (pending ??= fetchSecrets());
