import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

// Config lives in one SSM SecureString parameter rather than a Lambda environment
// variable, because everything CDK puts in `environment` is published as plaintext in the
// CloudFormation template and the bootstrap assets bucket. The CDK stack is the source of
// truth for the parameter name and injects it as SECRETS_PARAMETER.

const client = new SSMClient({});

// The promise, not the value: concurrent callers in one execution environment share a
// single round trip. Cleared on rejection so a transient failure does not poison the
// container for the rest of its life.
let pending;

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

/**
 * @returns {Promise<object>} the decrypted config, cached per execution environment
 */
export default function secrets() {
  if (!pending) {
    pending = fetchSecrets().catch((err) => {
      pending = undefined;
      throw err;
    });
  }

  return pending;
}
