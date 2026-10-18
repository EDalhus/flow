// Hendelser som sendes over WebSocket. Klienten bruker dem til å hente data på nytt.
export type FlowEvent =
  | { type: 'port_call.changed'; id: string }
  | { type: 'message.created'; port_call_id: string; message_id: string }
  | { type: 'boat.changed'; id: string }
  | { type: 'notification'; user_id: string }
  | { type: 'ais.updated' }
  | { type: 'trucks.changed' }
  | { type: 'bulk.changed' }
  | { type: 'production.changed' }
  | { type: 'orders.changed' };
