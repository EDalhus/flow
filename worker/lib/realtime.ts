import type { Context } from 'hono';
import type { FlowEvent } from '../../shared/events.ts';
import type { AppEnv } from '../types.ts';

export const ROOM = 'flatholmen';

/** Sender hendelser til alle tilkoblede klienter, uten å holde igjen svaret. */
export function publish(c: Context<AppEnv>, ...events: FlowEvent[]) {
  if (!events.length) return;
  const room = c.env.QUAY_ROOM.getByName(ROOM);
  c.executionCtx.waitUntil(
    room.broadcast(events).catch((err: unknown) => console.error('Kringkasting feilet', err)),
  );
}
