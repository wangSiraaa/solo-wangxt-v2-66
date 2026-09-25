/**
 * 引擎逻辑验证脚本（非应用代码）：
 *   npx esbuild scripts/verify.ts --bundle --format=esm --outfile=/tmp/verify.mjs
 *   node /tmp/verify.mjs
 */
import {
  buildDirectedGraph,
  computeLayers,
  findPath,
  findTransitivePairs,
  pairKey,
  partialOrderSignature,
  reachableFrom,
  stronglyConnectedComponents,
} from '../src/graph/engine';
import type { Locus, Relation } from '../src/types';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures++;
}

const loci: Locus[] = ['A', 'B', 'C', 'D', 'E'].map((code) => ({
  id: `id-${code}`,
  projectId: 'p',
  code,
  kind: 'deposit',
  label: '',
  note: '',
  createdAt: 0,
}));

const rel = (from: string, to: string, extra: Partial<Relation> = {}): Relation => ({
  id: `${from}${to}`,
  projectId: 'p',
  kind: 'earlier',
  fromId: `id-${from}`,
  toId: `id-${to}`,
  source: 'observation',
  status: 'active',
  evidenceIds: [],
  note: '',
  createdAt: 0,
  revokedAt: null,
  revokeReason: '',
  ...extra,
});

// A→B→C→D，C→E，另有矛盾记录 D→B（构成环 B→C→D→B）
const relations = [rel('A', 'B'), rel('B', 'C'), rel('C', 'D'), rel('C', 'E'), rel('D', 'B')];
const g = buildDirectedGraph(loci, relations);

// 1. 成环检测：新增 E→A 前，存在 A⇢E 路径
const back = findPath(g, 'id-A', 'id-E');
check('新增 E→A 时能定位已有路径 A⇢E', back !== null && back[0] === 'id-A' && back.at(-1) === 'id-E');

// 2. 矛盾分量：B、C、D 在同一个强连通分量
const sccs = stronglyConnectedComponents(g);
const conflict = sccs.find((c) => c.length > 1) ?? [];
check(
  'SCC 检出矛盾组 {B,C,D}',
  conflict.length === 3 && ['id-B', 'id-C', 'id-D'].every((id) => conflict.includes(id)),
);

// 3. 传递边：A→C、A→D、A→E、B→D、C→B、D→C 等均可由其他路径推出
const trans = findTransitivePairs(g);
check('A→C 被识别为传递边', trans.has(pairKey('id-A', 'id-C')) === false); // A→C 不是直接边，不在集合中
check('B→D 是传递边（B→C→D）', trans.has(pairKey('id-B', 'id-D')) === false); // B→D 也不是直接边
check('简单环中的直接边 B→C 不是传递边（去掉后 B 不可达 C）', !trans.has(pairKey('id-B', 'id-C')));

// 无环情形下的传递边
const dagRels = [rel('A', 'B'), rel('B', 'C'), rel('A', 'C')];
const dag = buildDirectedGraph(loci, dagRels);
const dagTrans = findTransitivePairs(dag);
check('DAG 中 A→C 是传递边', dagTrans.has(pairKey('id-A', 'id-C')));
check('DAG 中 A→B 不是传递边', !dagTrans.has(pairKey('id-A', 'id-B')));

// 4. 分层在有环时也能终止并给出结果
const layers = computeLayers(g);
check('含环图分层可完成，A 早于 E', (layers.get('id-A') ?? 99) < (layers.get('id-E') ?? -1));
check('同 SCC 节点同层', layers.get('id-B') === layers.get('id-C') && layers.get('id-C') === layers.get('id-D'));

// 5. 撤销/同时期关系不进图
const mixed = [
  rel('A', 'B'),
  rel('B', 'C', { status: 'revoked' }),
  rel('A', 'C', { kind: 'contemporary' }),
];
const g2 = buildDirectedGraph(loci, mixed);
check('已撤销关系不进图', !g2.hasEdge('id-B', 'id-C'));
check('同时期关联不进图', !g2.hasEdge('id-A', 'id-C'));
check('撤销后 A 不可达 C', !reachableFrom(g2, 'id-A').has('id-C'));

// 6. 导出→重新分配 id 导入后，偏序签名不变
const sig1 = partialOrderSignature(loci, relations);
const remap = new Map(loci.map((l) => [l.id, `new-${l.id}`]));
const loci2 = loci.map((l) => ({ ...l, id: remap.get(l.id)! }));
const rels2 = relations.map((r) => ({ ...r, fromId: remap.get(r.fromId)!, toId: remap.get(r.toId)! }));
const sig2 = partialOrderSignature(loci2, rels2);
check('id 重映射后偏序签名一致', sig1 === sig2);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
