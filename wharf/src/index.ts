import { loadConfig } from "./config.ts";
import { ComputerRegistry } from "./computers/registry.ts";
import { EventBus } from "./events.ts";
import { createApp, listen } from "./app.ts";
import { Store } from "./store.ts";
import { startWorker } from "./worker.ts";

const config = loadConfig();
const store = new Store(config);
const computers = new ComputerRegistry(config);
const events = new EventBus();
const { app, runtime } = createApp({ config, store, computers, events });

startWorker({ store, runtime, events });

listen(config, app);
console.log(`Wharf listening on http://${config.host}:${config.port}`);
console.log(`Default computer: ${config.defaultComputer}`);
