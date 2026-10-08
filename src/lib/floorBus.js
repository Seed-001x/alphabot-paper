// floorBus.js — live event bus for the AGENT FLOOR visualization.
// The desk's pipeline emits real events here (scan/vet/research/score/trade/
// risk); the AgentFloor component subscribes and animates token chips through
// the stations. Additive only: emitting never affects pipeline logic, and with
// zero subscribers the calls are no-ops. Unknown = no events = idle floor,
// never fake tokens.

const listeners = new Set();

export function subscribeFloor(cb) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function floorEmit(type, payload) {
  if (!listeners.size) return;
  const ev = { type, ts: Date.now(), ...(payload || {}) };
  for (const cb of listeners) {
    try { cb(ev); } catch { /* floor UI is a nicety */ }
  }
}
