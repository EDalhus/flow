import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { FlowEvent } from '../../../shared/events.ts';
import { chosenUser } from './api.ts';

// Én WebSocket per fane. Hendelser invaliderer berørte spørringer; ved gjenoppkobling
// hentes alt på nytt, siden vi kan ha gått glipp av hendelser.

export type Connection = 'kobler' | 'tilkoblet' | 'frakoblet';

export function useRealtime(): Connection {
  const qc = useQueryClient();
  const [state, setState] = useState<Connection>('kobler');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const handle = (e: FlowEvent) => {
      switch (e.type) {
        case 'port_call.changed':
          qc.invalidateQueries({ queryKey: ['port-calls'] });
          qc.invalidateQueries({ queryKey: ['port-call', e.id] });
          qc.invalidateQueries({ queryKey: ['call-log', e.id] });
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['order'] });
          qc.invalidateQueries({ queryKey: ['boats'] });
          break;
        case 'message.created':
          qc.invalidateQueries({ queryKey: ['messages', e.port_call_id] });
          qc.invalidateQueries({ queryKey: ['port-calls'] });
          break;
        case 'boat.changed':
          qc.invalidateQueries({ queryKey: ['boats'] });
          qc.invalidateQueries({ queryKey: ['boat', e.id] });
          qc.invalidateQueries({ queryKey: ['quay-logs'] });
          break;
        case 'ais.updated':
          qc.invalidateQueries({ queryKey: ['ais'] });
          qc.invalidateQueries({ queryKey: ['port-calls'] });
          break;
        case 'trucks.changed':
          qc.invalidateQueries({ queryKey: ['trucks'] });
          break;
        case 'bulk.changed':
          qc.invalidateQueries({ queryKey: ['bulk'] });
          break;
        case 'orders.changed':
          qc.invalidateQueries({ queryKey: ['orders'] });
          qc.invalidateQueries({ queryKey: ['order'] });
          break;
        case 'production.changed':
          qc.invalidateQueries({ queryKey: ['production'] });
          break;
        case 'notification':
          qc.invalidateQueries({ queryKey: ['notifications'] });
          break;
      }
    };

    const connect = () => {
      if (stopped) return;
      setState('kobler');
      const as = chosenUser();
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws${as ? `?as=${encodeURIComponent(as)}` : ''}`);
      ws.onopen = () => {
        if (attempt > 0) qc.invalidateQueries();
        attempt = 0;
        setState('tilkoblet');
        ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), 25_000);
      };
      ws.onmessage = msg => {
        if (msg.data === 'pong') return;
        try { handle(JSON.parse(msg.data)); } catch { /* ukjent melding */ }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (stopped) return;
        setState('frakoblet');
        attempt++;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      };
    };
    connect();

    return () => {
      stopped = true;
      clearInterval(ping);
      clearTimeout(retry);
      ws?.close();
    };
  }, [qc]);

  return state;
}
