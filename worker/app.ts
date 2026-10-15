import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireUser } from './auth/access.ts';
import { ROOM } from './lib/realtime.ts';
import ais from './routes/ais.ts';
import boats from './routes/boats.ts';
import bulk from './routes/bulk.ts';
import production from './routes/production.ts';
import trucks from './routes/trucks.ts';
import catalog from './routes/catalog.ts';
import { messages, notifications } from './routes/messages.ts';
import portCalls, { collisionsRoute } from './routes/portCalls.ts';
import { photos, upload } from './routes/photos.ts';
import { deliver, quayLogs } from './routes/quayLogs.ts';
import reports from './routes/reports.ts';
import type { AppEnv } from './types.ts';

export const app = new Hono<AppEnv>().basePath('/api');

// Helsesjekk uten innlogging (for overvåking); avslører ingen data.
app.get('/health', c => c.json({ ok: true }));

app.use('*', requireUser);

app.route('/', catalog);
app.route('/port-calls', portCalls);
app.route('/port-calls', messages);
app.route('/port-calls', deliver);
app.route('/port-calls', upload);
app.route('/photos', photos);
app.route('/ais', ais);
app.route('/trucks', trucks);
app.route('/bulk', bulk);
app.route('/production', production);
app.route('/collisions', collisionsRoute);
app.route('/quay-logs', quayLogs);
app.route('/notifications', notifications);
app.route('/boats', boats);
app.route('/reports', reports);

// Sanntid: WebSocket videresendes til Durable Object-en, merket med brukeren.
app.get('/ws', async c => {
  if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'Forventet WebSocket.' }, 426);
  const req = new Request(c.req.raw);
  req.headers.set('X-Flow-User', c.get('user').id);
  return c.env.QUAY_ROOM.getByName(ROOM).fetch(req);
});

app.notFound(c => c.json({ error: 'Fant ikke ressursen.' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof SyntaxError) return c.json({ error: 'Ugyldig JSON.' }, 400);
  console.error(err);
  return c.json({ error: 'Noe gikk galt på serveren.' }, 500);
});
