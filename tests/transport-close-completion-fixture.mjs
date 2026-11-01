import { CodexAppServerClient } from "../plugins/codex/scripts/lib/app-server.mjs";

const connect = CodexAppServerClient.connect;
CodexAppServerClient.connect = async (cwd, options) => {
  const client = await connect.call(CodexAppServerClient, cwd, { ...options, disableBroker: true });
  const transportExit = client.exitPromise;
  const close = client.close.bind(client);
  client.exitPromise = new Promise(() => {});
  client.close = async () => {
    client.exitPromise = transportExit;
    await transportExit;
    process.stderr.write("Transport closed before inferred result delivery.\n");
    await close();
  };
  return client;
};

await import("../plugins/codex/scripts/codex-companion.mjs");
