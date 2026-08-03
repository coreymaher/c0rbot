#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { C0rbotStack } from "../lib/c0rbot-stack";

const app = new cdk.App();

new C0rbotStack(app, "c0rbot", {
  stackName: "c0rbot",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});
