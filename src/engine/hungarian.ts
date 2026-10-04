// Minimum-cost assignment (Kuhn-Munkres with potentials), O(n^2 m).
// `cost[i][j]` is the cost of giving row i to column j. Entries >= `forbid`
// are never used. Each row may also stay unassigned at cost `unassigned`.
// Returns, for every row, the chosen column or -1.

export function assign(cost: number[][], unassigned = 1, forbid = 1e5): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  // Columns m..m+n-1 are per-row "leave unassigned" slots.
  const M = m + n;
  const INF = 1e18;
  const c = (i: number, j: number) => {
    if (j < m) return cost[i][j] >= forbid ? forbid * 10 : cost[i][j];
    return j - m === i ? unassigned : forbid * 10;
  };
  const u = new Float64Array(n + 1);
  const v = new Float64Array(M + 1);
  const p = new Int32Array(M + 1);
  const way = new Int32Array(M + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(M + 1).fill(INF);
    const used = new Uint8Array(M + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= M; j++) {
        if (used[j]) continue;
        const cur = c(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= M; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    const i = p[j];
    if (i > 0 && cost[i - 1][j - 1] < forbid) out[i - 1] = j - 1;
  }
  return out;
}
