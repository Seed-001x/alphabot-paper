// ALPHABOT v3.5 — work queues between pipeline stages.
// SCAN → vet → rug → research → score → (trade/risk). Each stage drains at
// its own pace per cycle, so slow research (page reads) never blocks fast
// scanning. In-memory, cap ~50 each; full → drop oldest, never block, never
// crash. Additive: stage logic (kill chain / research / score) is untouched,
// only the handoff between stages goes through queues.

export class StageQueue {
  constructor(name, cap = 50) {
    this.name = name;
    this.cap = cap;
    this.q = [];
    this.seen = new Set(); // mint dedupe within the queue
    this.dropped = 0;
    this.pushed = 0;
  }
  keyOf(item) { return item && (item.address || item.mint); }
  push(item) {
    if (!item) return false;
    const k = this.keyOf(item);
    if (k && this.seen.has(k)) return false;
    if (this.q.length >= this.cap) {
      const old = this.q.shift();
      const ok = old && this.keyOf(old);
      if (ok) this.seen.delete(ok);
      this.dropped++;
    }
    this.q.push(item);
    if (k) this.seen.add(k);
    this.pushed++;
    return true;
  }
  unshiftFront(items) {
    for (const it of (items || [])) {
      const k = this.keyOf(it);
      if (k && this.seen.has(k)) continue;
      this.q.unshift(it);
      if (k) this.seen.add(k);
    }
  }
  drain(n) {
    const out = this.q.splice(0, n);
    for (const it of out) {
      const k = this.keyOf(it);
      if (k) this.seen.delete(k);
    }
    return out;
  }
  get size() { return this.q.length; }
  stats() { return { name: this.name, size: this.q.length, dropped: this.dropped, pushed: this.pushed }; }
}

// Stage handoffs. trade/risk queues are light: entries flow into trade for
// the trader seat, exits flow into risk for the risk seat.
export const Q = {
  vet: new StageQueue('vet'),           // scan candidates awaiting kill chain
  rug: new StageQueue('rug'),           // free/trade survivors awaiting rug pass
  research: new StageQueue('research'), // rug survivors awaiting research
  score: new StageQueue('score'),       // researched awaiting score+trade
  trade: new StageQueue('trade'),       // paper entries (trader seat feed)
  risk: new StageQueue('risk'),         // exits (risk seat feed)
};

export function queueStats() {
  const o = {};
  for (const k of Object.keys(Q)) o[k] = Q[k].stats();
  return o;
}
