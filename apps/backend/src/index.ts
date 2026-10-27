import "dotenv/config";
import { MongoClient } from "mongodb";
import { createApp } from "./app.js";
import { RelayStore } from "./relay.js";
import { PublicRates } from "./rates.js";

async function start() {
  const { MONGODB_URI, MONGODB_DB, WEB_ORIGIN } = process.env;
  const port = Number(process.env.PORT || "3001");
  if (!MONGODB_URI || !/^mongodb(?:\+srv)?:\/\//.test(MONGODB_URI) || !MONGODB_DB || !/^splyt_private_[a-z0-9_]{1,40}$/.test(MONGODB_DB) || !WEB_ORIGIN || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Configure PORT, WEB_ORIGIN, MONGODB_URI and a fresh MONGODB_DB beginning splyt_private_.");
  }
  const origin = new URL(WEB_ORIGIN);
  if (origin.origin !== WEB_ORIGIN || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))) throw new Error("WEB_ORIGIN must be one HTTPS origin or a local development origin.");
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const store = new RelayStore(client.db(MONGODB_DB));
  await store.initialise();
  const server = createApp(store, { webOrigin: WEB_ORIGIN, rates: new PublicRates() }).listen(port, () => console.info(`Splyt encrypted relay listening on port ${port}.`));
  const close = () => { server.close(() => { void client.close().then(() => process.exit(0)); }); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

start().catch(() => {
  console.error("Relay startup failed. Check the required environment, fresh database namespace and database availability. Sensitive connection details are not logged.");
  process.exitCode = 1;
});
