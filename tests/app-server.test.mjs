import { test } from "node:test";
import assert from "node:assert/strict";

import { AppServerClientBase, CodexAppServerClient } from "../plugins/codex/scripts/lib/app-server.mjs";
import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { makeTempDir } from "./helpers.mjs";

/** Minimal client that records the JSON-RPC messages it would send. */
class CapturingClient extends AppServerClientBase {
  constructor() {
    super(process.cwd());
    this.sent = [];
  }
  sendMessage(message) {
    this.sent.push(message);
  }
}

test("handleServerRequest accepts MCP elicitation requests instead of rejecting them", () => {
  const client = new CapturingClient();
  client.handleServerRequest({
    id: 7,
    method: "mcpServer/elicitation/request",
    params: { threadId: "t1" }
  });
  assert.deepEqual(client.sent, [
    { id: 7, result: { action: "accept", content: null, _meta: null } }
  ]);
});

test("handleServerRequest still rejects unknown server requests with -32601", () => {
  const client = new CapturingClient();
  client.handleServerRequest({ id: 8, method: "some/unknown/request", params: {} });
  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0].id, 8);
  assert.equal(client.sent[0].result, undefined);
  assert.equal(client.sent[0].error.code, -32601);
});

function escapeLineSeparators(value) {
  return value.replace(/[\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

test("spawned client parses app-server messages containing U+2028 and U+2029 and stays connected", async () => {
  const binDir = makeTempDir();
  installFakeCodex(binDir, "line-separator");
  const client = await CodexAppServerClient.connect(makeTempDir(), { disableBroker: true, env: buildEnv(binDir) });

  try {
    const first = await client.request("account/read", {}).catch((error) => {
      throw new Error(`account/read failed: ${error.message}`);
    });
    assert.equal(escapeLineSeparators(first.account.email), "line\\u2028para\\u2029@example.com");

    const second = await client.request("account/read", {}).catch((error) => {
      throw new Error(`second account/read failed: ${error.message}`);
    });
    assert.equal(escapeLineSeparators(second.account.email), "line\\u2028para\\u2029@example.com");
    assert.equal(client.exitError, null);
  } finally {
    await client.close();
  }
});
