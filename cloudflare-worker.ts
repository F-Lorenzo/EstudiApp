// Worker de producción: el de OpenNext (`.open-next/worker.js`, lo genera `opennextjs-cloudflare build`) más el
// handler `scheduled` que dispara el cron de `wrangler.jsonc` (`triggers.crons`). Ver docs/CLOUDFLARE.md.
//
// Lo empaqueta Wrangler (sin chequeo de tipos) y queda fuera de tsconfig: `.open-next/worker.js` recién existe
// después del build. La lógica está en src/lib/cron/scheduled.ts, que sí tiene tipos y pruebas.
import openNextWorker from "./.open-next/worker.js";
import { runScheduledMaintenance } from "./src/lib/cron/scheduled";

// Se reexportan para que el Worker siga declarando lo mismo que el de OpenNext.
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

const worker = {
  fetch: openNextWorker.fetch,
  async scheduled(_controller, env, ctx) {
    await runScheduledMaintenance(openNextWorker.fetch, env, ctx);
  },
};

export default worker;
