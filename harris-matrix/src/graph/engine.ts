import { DirectedGraph } from 'graphology';
import type { Locus, Relation } from '../types';

/**
 * 图引擎：只负责「先后关系」构成的有向图。
 * 同时期关联（contemporary）与已撤销判断一律不进图。
 */

export const pairKey = (a: string, b: string) => `${a}→${b}`;

/** 由有效的 earlier 关系构建有向图；同一对层位的多条记录合并为一条边 */
export function buildDirectedGraph(loci: Locus[], relations: Relation[]): DirectedGraph {
  const g = new DirectedGraph();
  for (const l of loci) g.addNode(l.id);
  for (const r of relations) {
    if (r.kind !== 'earlier' || r.status !== 'active') continue;
    if (r.fromId === r.toId) continue;
    if (!g.hasNode(r.fromId) || !g.hasNode(r.toId)) continue;
    if (!g.hasEdge(r.fromId, r.toId)) g.addEdge(r.fromId, r.toId);
  }
  return g;
}

/** BFS 找 from 到 to 的一条有向路径，找不到返回 null */
export function findPath(g: DirectedGraph, from: string, to: string): string[] | null {
  if (!g.hasNode(from) || !g.hasNode(to)) return null;
  if (from === to) return [from];
  const prev = new Map<string, string | null>([[from, null]]);
  const queue: string[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    let hit = false;
    g.forEachOutboundNeighbor(cur, (nb) => {
      if (hit || prev.has(nb)) return;
      prev.set(nb, cur);
      if (nb === to) hit = true;
      else queue.push(nb);
    });
    if (hit) {
      const path = [to];
      let p = prev.get(to)!;
      while (p !== null) {
        path.unshift(p);
        p = prev.get(p)!;
      }
      return path;
    }
  }
  return null;
}

/** 从 start 出发可达的全部节点（不含 start 自身） */
export function reachableFrom(g: DirectedGraph, start: string): Set<string> {
  const seen = new Set<string>();
  if (!g.hasNode(start)) return seen;
  const stack = [start];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    g.forEachOutboundNeighbor(cur, (nb) => {
      if (!seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    });
  }
  seen.delete(start);
  return seen;
}

/**
 * 传递边检测：若去掉边 (s,t) 后 s 仍可达 t，则该边为传递边。
 * 简化视图只隐藏这些边，绝不删除任何原始记录。
 */
export function findTransitivePairs(g: DirectedGraph): Set<string> {
  const pairs: Array<[string, string]> = [];
  g.forEachEdge((_edge, _attr, s, t) => pairs.push([s, t]));
  const result = new Set<string>();
  for (const [s, t] of pairs) {
    g.dropEdge(s, t);
    if (findPath(g, s, t)) result.add(pairKey(s, t));
    g.addEdge(s, t);
  }
  return result;
}

/** Tarjan 强连通分量；分量大小 > 1 即互相矛盾的记录组 */
export function stronglyConnectedComponents(g: DirectedGraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  function strongconnect(v: string) {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    g.forEachOutboundNeighbor(v, (w) => {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    });
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      result.push(comp);
    }
  }

  g.forEachNode((n) => {
    if (!index.has(n)) strongconnect(n);
  });
  return result;
}

/**
 * 分层（最长路径法）：把强连通分量缩点成 DAG 后做拓扑分层，
 * 有环时同分量节点落在同一层，布局不会死循环。
 */
export function computeLayers(g: DirectedGraph): Map<string, number> {
  const sccs = stronglyConnectedComponents(g);
  const compOf = new Map<string, number>();
  sccs.forEach((comp, i) => comp.forEach((n) => compOf.set(n, i)));

  const adj: Array<Set<number>> = sccs.map(() => new Set());
  const indeg = new Array<number>(sccs.length).fill(0);
  g.forEachEdge((_e, _a, s, t) => {
    const cs = compOf.get(s)!;
    const ct = compOf.get(t)!;
    if (cs !== ct && !adj[cs].has(ct)) {
      adj[cs].add(ct);
      indeg[ct]++;
    }
  });

  const layer = new Array<number>(sccs.length).fill(0);
  const queue: number[] = [];
  indeg.forEach((d, i) => {
    if (d === 0) queue.push(i);
  });
  while (queue.length > 0) {
    const c = queue.shift()!;
    for (const n of adj[c]) {
      layer[n] = Math.max(layer[n], layer[c] + 1);
      indeg[n]--;
      if (indeg[n] === 0) queue.push(n);
    }
  }

  const result = new Map<string, number>();
  sccs.forEach((comp, i) => comp.forEach((n) => result.set(n, layer[i])));
  return result;
}

/**
 * 自动排布：按分层结果生成画布坐标（最早的层在底部）。
 * 孤立层位（无任何有效关系）单独放在右侧一列。
 */
export function computeAutoLayout(
  loci: Locus[],
  relations: Relation[],
): Array<{ locusId: string; x: number; y: number }> {
  const g = buildDirectedGraph(loci, relations);
  const layers = computeLayers(g);

  const connected = new Set<string>();
  for (const r of relations) {
    if (r.status !== 'active') continue;
    connected.add(r.fromId);
    connected.add(r.toId);
  }

  const byLayer = new Map<number, Locus[]>();
  const isolated: Locus[] = [];
  for (const l of loci) {
    if (!connected.has(l.id)) {
      isolated.push(l);
      continue;
    }
    const ly = layers.get(l.id) ?? 0;
    if (!byLayer.has(ly)) byLayer.set(ly, []);
    byLayer.get(ly)!.push(l);
  }

  const maxLayer = Math.max(0, ...layers.values());
  const result: Array<{ locusId: string; x: number; y: number }> = [];
  let maxRowWidth = 0;

  for (const [ly, ls] of byLayer) {
    ls.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true }));
    maxRowWidth = Math.max(maxRowWidth, ls.length);
    const y = 90 + (maxLayer - ly) * 120;
    ls.forEach((l, i) => {
      result.push({ locusId: l.id, x: 120 + i * 170 - ((ls.length - 1) * 170) / 2, y });
    });
  }

  isolated.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true }));
  const isoX = 120 + (maxRowWidth > 0 ? (maxRowWidth * 170) / 2 + 170 : 0);
  isolated.forEach((l, i) => {
    result.push({ locusId: l.id, x: isoX, y: 90 + i * 110 });
  });

  return result;
}

/**
 * 偏序签名：以层位编号表示的可达集。
 * 导出时写入文件，导入后重算比对，验证偏序未被改变。
 */
export function partialOrderSignature(loci: Locus[], relations: Relation[]): string {
  const g = buildDirectedGraph(loci, relations);
  const code = new Map(loci.map((l) => [l.id, l.code]));
  const rows = loci.map((l) => {
    const reach = [...reachableFrom(g, l.id)].map((id) => code.get(id) ?? id).sort();
    return `${l.code}⇒${reach.join(',')}`;
  });
  return rows.sort().join('\n');
}
