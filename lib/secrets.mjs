import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

// Config lives in one SSM SecureString parameter rather than a Lambda environment
// variable, because everything CDK puts in `environment` is published as plaintext in the
// CloudFormation template and the bootstrap assets bucket. The CDK stack is the source of
// truth for the parameter name and injects it as SECRETS_PARAMETER.

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

// The promise, not the value, so concurrent callers share one round trip. No reset on
// failure: every caller awaits this at module scope, so a rejection fails init and the
// execution environment is discarded rather than retried.
let pending;

/**
 * @returns {Promise<object>} the decrypted config, cached per execution environment
 */
export default () => (pending ??= fetchSecrets());
