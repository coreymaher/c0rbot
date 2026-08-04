#!/bin/bash

# A deploy does not carry config; this is the only path it takes to production.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARAMETER="/c0rbot/environment"
PROFILE=${AWS_PROFILE:-c0rbot-admin}
REGION=${AWS_REGION:-us-east-1}

WORK=$(mktemp -d)
TMP="$WORK/value.json"
PLAINTEXT="$WORK/environment.js"
trap 'rm -rf "$WORK"' EXIT INT TERM

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
