import { runAisSync } from './ais/sync.ts';
import { app } from './app.ts';
import { cleanupOrphanPhotos } from './routes/photos.ts';

export { QuayRoom } from './realtime/QuayRoom.ts';

/** Må samsvare med "triggers.crons" i wrangler.jsonc. */
export const CRON_AIS = '* * * * *';
export const CRON_CLEANUP = '17 3 * * *';

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    if (controller.cron === CRON_CLEANUP) {
      ctx.waitUntil(cleanupOrphanPhotos(env).then(n => n && console.log(`Ryddet ${n} bilder uten kaibok`)));
      return;
    }
    ctx.waitUntil(runAisSync(env).then(r => {
      if (!r.ok) console.warn('AIS:', r.message);
    }));
  },
} satisfies ExportedHandler<Env>;
