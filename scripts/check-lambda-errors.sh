#!/bin/bash

# Check which Lambda functions had errors within a time window
# Usage: ./check-lambda-errors.sh [hours] [profile] [region]
#   hours: how many hours to look back (default: 24)
#   profile: AWS profile to use (default: c0rbot-admin)
#   region: AWS region (default: us-east-1)

HOURS=${1:-24}
PROFILE=${2:-c0rbot-admin}
REGION=${3:-us-east-1}

# Calculate timestamps
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  START_TIME=$(date -u -v-${HOURS}H +%Y-%m-%dT%H:%M:%S)
else
  # Linux
  START_TIME=$(date -u -d "${HOURS} hours ago" +%Y-%m-%dT%H:%M:%S)
fi
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%S)

echo "Checking Lambda errors from $START_TIME to $END_TIME"
echo "Profile: $PROFILE, Region: $REGION"
echo ""

# Get all Lambda functions with error metrics
FUNCTIONS=$(aws cloudwatch list-metrics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --profile $PROFILE \
  --region $REGION \
  --query 'Metrics[].Dimensions[?Name==`FunctionName`].Value' \
  --output text | tr '\t' '\n' | sort -u)

if [ -z "$FUNCTIONS" ]; then
  echo "No Lambda functions found with error metrics"
  exit 0
fi

FOUND_ERRORS=false

# Check each function for errors
for FUNCTION in $FUNCTIONS; do
  ERROR_COUNT=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Errors \
    --dimensions Name=FunctionName,Value=$FUNCTION \
    --start-time $START_TIME \
    --end-time $END_TIME \
    --period $((HOURS * 3600)) \
    --statistics Sum \
    --profile $PROFILE \
    --region $REGION \
    --query 'Datapoints[0].Sum' \
    --output text)

  if [ "$ERROR_COUNT" != "None" ] && [ "$ERROR_COUNT" != "" ] && [ "$ERROR_COUNT" != "0.0" ]; then
    echo "❌ $FUNCTION: $ERROR_COUNT errors"
    FOUND_ERRORS=true

    # Get 5-minute breakdown
    echo "   Error breakdown (5-minute intervals):"
    aws cloudwatch get-metric-statistics \
      --namespace AWS/Lambda \
      --metric-name Errors \
      --dimensions Name=FunctionName,Value=$FUNCTION \
      --start-time $START_TIME \
      --end-time $END_TIME \
      --period 300 \
      --statistics Sum \
      --profile $PROFILE \
      --region $REGION \
      --query 'Datapoints[?Sum > `0`] | sort_by(@, &Timestamp)[*].[Timestamp, Sum]' \
      --output text | while read timestamp count; do
        echo "     $timestamp: $count errors"
      done
    echo ""
  fi
done

if [ "$FOUND_ERRORS" = false ]; then
  echo "✅ No Lambda errors found in the last $HOURS hours"
fi
