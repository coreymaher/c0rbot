// A stand-in for SSM, so the bundle load test can run offline.
//
// The bundles fetch their config through lib/secrets.mjs at import time. Rather than give
// that module a test-only bypass -- which would be a way to feed secrets in through an
// environment variable, the thing this whole change removes -- point the SDK here with
// AWS_ENDPOINT_URL_SSM and answer the one call it makes.
//
// Usage: node ssm-stub.mjs <config-module> <port-file>
// Serves the `environment()` export of <config-module>, and writes its port to <port-file>
// once listening.

import { createServer } from "http";
import { writeFileSync } from "fs";
import { createRequire } from "module";

const [configModule, portFile] = process.argv.slice(2);

const require = createRequire(import.meta.url);
const { environment } = require(configModule);
const value = environment().environment;

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const target = req.headers["x-amz-target"] ?? "";

    if (!target.endsWith("GetParameter")) {
      res.writeHead(400, { "Content-Type": "application/x-amz-json-1.1" });
      res.end(
        JSON.stringify({ __type: "InvalidAction", message: `got ${target}` }),
      );
      return;
    }

    const { Name } = JSON.parse(body || "{}");

    res.writeHead(200, { "Content-Type": "application/x-amz-json-1.1" });
    res.end(
      JSON.stringify({
        Parameter: { Name, Type: "SecureString", Version: 1, Value: value },
      }),
    );
  });
});

server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
});
