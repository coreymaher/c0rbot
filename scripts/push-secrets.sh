#!/bin/bash

# Push the SOPS-encrypted config into the SSM parameter the Lambdas read at init. This is
# the only path config takes to production -- a deploy does not carry it.
#
# Rotating a key is `npm run encrypt && npm run secrets:push`, no deploy. Running
# containers keep the value they fetched until they cycle; `cdk deploy` replaces them.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARAMETER="/c0rbot/environment"
PROFILE=${AWS_PROFILE:-c0rbot-admin}
REGION=${AWS_REGION:-us-east-1}

# One 0700 directory, because mktemp -d needs no template and so behaves the same on BSD
# and GNU. TMP exists so the secret is never a --value argument, where it would show in
# `ps` and shell history; PLAINTEXT needs a real .js name because node requires it.
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
