import { DurableObject } from 'cloudflare:workers';
import type { FlowEvent } from '../../shared/events.ts';

// Én instans for hele kaia. Bruker WebSocket Hibernation: objektet sover mellom
// meldinger og koster da ingenting, men forbindelsene holdes åpne.
export class QuayRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Klientens hjerteslag besvares uten å vekke objektet.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Forventet WebSocket', { status: 426 });
    const userId = request.headers.get('X-Flow-User');
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, userId ? [`user:${userId}`] : []);
    return new Response(null, { status: 101, webSocket: client });
  }

  async broadcast(events: FlowEvent[]): Promise<number> {
    let sent = 0;
    for (const event of events) {
      const sockets = event.type === 'notification' ? this.ctx.getWebSockets(`user:${event.user_id}`) : this.ctx.getWebSockets();
      const payload = JSON.stringify(event);
      for (const ws of sockets) {
        try { ws.send(payload); sent++; } catch { /* lukket forbindelse ryddes av runtime */ }
      }
    }
    return sent;
  }

  async webSocketMessage(): Promise<void> {
    // Klienter sender bare "ping", som håndteres av auto-respons.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code, reason); } catch { /* allerede lukket */ }
  }
}
