#!/bin/bash

# Push the SOPS-encrypted config into the SSM parameter the Lambdas read at init.
#
# environment.js.enc stays the source of truth; this is how it reaches AWS. Nothing here
# touches the stack -- rotating a key is `npm run encrypt && npm run secrets:push`, with
# no deploy. Running containers keep the value they fetched until they cycle; force it
# sooner with a `cdk deploy`, which replaces them.
#
# Usage: ./push-secrets.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARAMETER="/c0rbot/environment"
PROFILE=${AWS_PROFILE:-c0rbot-admin}
REGION=${AWS_REGION:-us-east-1}

# TMP holds the value for `aws ssm put-parameter`: written to a file rather than passed on
# the command line, where a --value argument is visible in `ps` and lands in shell history.
# PLAINTEXT is the decrypted module, read for the same `environment()` export the stack
# used to consume so this stays in step with whatever shape that file has.
TMP=$(mktemp)
PLAINTEXT=$(mktemp -t environment-XXXXXX.js)
trap 'rm -f "$TMP" "$PLAINTEXT"' EXIT
chmod 600 "$TMP" "$PLAINTEXT"

sops -d "$REPO_ROOT/environment.js.enc" > "$PLAINTEXT"

node -e '
  const { environment } = require(process.argv[1]);
  const value = environment().environment;

  JSON.parse(value); // fail here rather than in a Lambda at init
  if (Buffer.byteLength(value) > 4096) {
    throw new Error(
      `config is ${Buffer.byteLength(value)} bytes -- an SSM Standard parameter caps at 4096`,
    );
  }

  require("fs").writeFileSync(process.argv[2], value);
' "$PLAINTEXT" "$TMP"

aws ssm put-parameter \
  --name "$PARAMETER" \
  --type SecureString \
  --tier Standard \
  --value "file://$TMP" \
  --overwrite \
  --profile "$PROFILE" \
  --region "$REGION" \
  --output text \
  --query Version \
  | xargs -I {} echo "Pushed $PARAMETER (version {})"
