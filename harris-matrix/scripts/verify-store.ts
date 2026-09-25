/**
 * Store 级验证（用 fake-indexeddb 模拟浏览器环境）：
 *   npx esbuild scripts/verify-store.ts --bundle --format=esm --outfile=/tmp/verify-store.mjs
 *   node /tmp/verify-store.mjs
 */
import 'fake-indexeddb/auto';
import { createPinia, setActivePinia } from 'pinia';
import { useProjectStore } from '../src/store/project';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures++;
}

setActivePinia(createPinia());
const store = useProjectStore();

await store.seedExample();

// 1. 示例数据：矛盾组、孤立层位、同时期关联
check('示例工程检出 1 组矛盾记录', store.conflictComponents.length === 1);
const j1 = store.loci.find((l) => l.code === 'J1')!;
check('J1 被识别为孤立层位', store.isolatedLocusIds.has(j1.id));
const h1f = store.loci.find((l) => l.code === 'H1①')!;
const m1f = store.loci.find((l) => l.code === 'M1①')!;
check(
  '同时期关联未成为有向边',
  !store.graph.hasEdge(h1f.id, m1f.id) && !store.graph.hasEdge(m1f.id, h1f.id),
);

// 2. 成环检测并定位路径：(2) 已晚于 (6)，再新增 (2)→(6) 必成环
const l2 = store.loci.find((l) => l.code === '(2)')!;
const l6 = store.loci.find((l) => l.code === '(6)')!;
const added = await store.addRelation({
  kind: 'earlier',
  fromId: l2.id,
  toId: l6.id,
  source: 'observation',
  evidenceIds: [],
  note: '',
});
check('成环关系被拒绝入库', !added);
check('成环路径已定位', !!store.cycleError && store.cycleError.path.length >= 3);

// 3. 批量撤销矛盾记录（H1①→(3)），矛盾解除但记录保留
const r14 = store.relations.find((r) => r.note.includes('记录员乙'))!;
await store.revokeRelations([r14.id], '核查后以剖面图 P-07 为准');
check('撤销一条矛盾记录后矛盾解除', store.conflictComponents.length === 0);
check('被撤销判断分开保存', store.relations.find((r) => r.id === r14.id)?.status === 'revoked');

// 4. 撤销批量操作：关系与证据引用一起恢复
await store.undoLatest();
const restored = store.relations.find((r) => r.id === r14.id)!;
check('撤销批量操作后判断恢复为有效', restored.status === 'active');
check('证据引用一起恢复', restored.evidenceIds.includes('E4'));
check('矛盾组随之重新出现', store.conflictComponents.length === 1);

// 5. 传递推断是批量操作，可一次撤销
const before = store.relations.length;
const n = await store.inferTransitiveRelations();
check('传递推断新增关系', n > 0 && store.relations.length === before + n);
await store.undoLatest();
check('撤销推断后关系数还原', store.relations.length === before);

// 6. 简化视图只隐藏传递边，不删除记录
const l5 = store.loci.find((l) => l.code === '(5)')!;
const l3 = store.loci.find((l) => l.code === '(3)')!;
check('(5)→(3) 被识别为传递边', store.transitivePairs.has(`${l5.id}→${l3.id}`));
store.viewMode = 'simplified';
check(
  '简化视图中传递边被隐藏',
  !store.visibleRelations.some((r) => r.kind === 'earlier' && r.fromId === l5.id && r.toId === l3.id),
);
check(
  '原始记录仍在库中',
  store.relations.some((r) => r.fromId === l5.id && r.toId === l3.id && r.status === 'active'),
);
store.viewMode = 'raw';

// 7. 导出→导入：偏序不变
const json = await store.exportProject();
const res = await store.importProject(json);
check('导入成功且偏序校验一致', res.ok && res.message.includes('偏序校验一致'));
check('导入后关系数与导出时一致', store.relations.length === before);
check('导入生成新工程', store.currentProject?.name.includes('（导入）') === true);

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
