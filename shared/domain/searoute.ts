// Korteste vei over vann i et rutenett (true = vann). Brukes til å anslå seilingsdistansen
// fra et fartøy til kaia, i stedet for luftlinje over land.

export type Cell = [number, number];

/** Nærmeste vannrute innenfor `radius` ruter (bredde først), eller null. */
export function snapToWater(mask: Uint8Array, w: number, h: number, [x0, y0]: Cell, radius: number): Cell | null {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  if (inside(x0, y0) && mask[y0 * w + x0]) return [x0, y0];
  for (let r = 1; r <= radius; r++) {
    let best: Cell | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx, y = y0 + dy;
        if (!inside(x, y) || !mask[y * w + x]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Beholder bare den største sammenhengende vannflaten (havet) i masken. Endrer masken. */
export function largestComponent(mask: Uint8Array, w: number, h: number): void {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let next = 0, best = 0, bestSize = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue;
    next++;
    let size = 0, top = 0;
    stack[top++] = i; label[i] = next;
    while (top) {
      const j = stack[--top]; size++;
      const x = j % w;
      const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w];
      for (const k of nb) if (k >= 0 && k < mask.length && mask[k] && !label[k]) { label[k] = next; stack[top++] = k; }
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  for (let i = 0; i < mask.length; i++) mask[i] = label[i] === best ? 1 : 0;
}

/** A* med 8 naboer. Returnerer rutene fra start til mål, eller null hvis det ikke finnes vei. */
export function findPath(mask: Uint8Array, w: number, h: number, start: Cell, goal: Cell): Cell[] | null {
  const n = w * h;
  const s = start[1] * w + start[0];
  const t = goal[1] * w + goal[0];
  if (!mask[s] || !mask[t]) return null;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gx = goal[0], gy = goal[1];
  const hfn = (i: number) => {
    const dx = Math.abs((i % w) - gx), dy = Math.abs(((i / w) | 0) - gy);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new MinHeap(Math.min(n, 1 << 16));
  g[s] = 0;
  heap.push(s, hfn(s));
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const i = heap.pop();
    if (i === t) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy, c] of D) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j] || closed[j]) continue;
      // Ikke skjær hjørner over land.
      if (dx && dy && (!mask[y * w + nx] || !mask[ny * w + x])) continue;
      const ng = g[i] + c;
      if (ng < g[j]) { g[j] = ng; came[j] = i; heap.push(j, ng + hfn(j)); }
    }
  }
  if (came[t] === -1 && s !== t) return null;
  const path: Cell[] = [];
  for (let i = t; i !== -1; i = came[i]) path.push([i % w, (i / w) | 0]);
  return path.reverse();
}

/** Fri sikt over vann mellom to ruter (Bresenham). */
export function lineOfSight(mask: Uint8Array, w: number, [x0, y0]: Cell, [x1, y1]: Cell): boolean {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!mask[y0 * w + x0]) return false;
    if (x0 === x1 && y0 === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Retter ut ruten: hopper over punkter så lenge det er fri sikt over vann. */
export function smoothPath(mask: Uint8Array, w: number, path: Cell[]): Cell[] {
  if (path.length < 3) return path;
  const out: Cell[] = [path[0]];
  let a = 0;
  while (a < path.length - 1) {
    let b = path.length - 1;
    while (b > a + 1 && !lineOfSight(mask, w, path[a], path[b])) b--;
    out.push(path[b]);
    a = b;
  }
  return out;
}

class MinHeap {
  private ids: Int32Array;
  private pr: Float32Array;
  size = 0;
  constructor(cap: number) { this.ids = new Int32Array(cap); this.pr = new Float32Array(cap); }
  push(id: number, p: number) {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2); ids.set(this.ids); this.ids = ids;
      const pr = new Float32Array(this.size * 2); pr.set(this.pr); this.pr = pr;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pr[parent] <= p) break;
      this.ids[i] = this.ids[parent]; this.pr[i] = this.pr[parent]; i = parent;
    }
    this.ids[i] = id; this.pr[i] = p;
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids[--this.size], lastP = this.pr[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.pr[c + 1] < this.pr[c]) c++;
      if (this.pr[c] >= lastP) break;
      this.ids[i] = this.ids[c]; this.pr[i] = this.pr[c]; i = c;
    }
    this.ids[i] = lastId; this.pr[i] = lastP;
    return top;
  }
}
