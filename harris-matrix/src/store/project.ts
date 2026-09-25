import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import type {
  CanvasPosition,
  Evidence,
  Locus,
  LocusKind,
  Operation,
  Project,
  Relation,
  RelationKind,
  RelationSource,
  UndoAction,
} from '../types';
import {
  buildDirectedGraph,
  computeAutoLayout,
  findPath,
  findTransitivePairs,
  pairKey,
  partialOrderSignature,
  reachableFrom,
  stronglyConnectedComponents,
} from '../graph/engine';
import { uid, plain } from '../utils';
import { seedExampleProject } from '../seed';

export const useProjectStore = defineStore('project', () => {
  // ---------- 状态 ----------
  const projects = ref<Project[]>([]);
  const currentProject = ref<Project | null>(null);
  const loci = ref<Locus[]>([]);
  const relations = ref<Relation[]>([]);
  const evidences = ref<Evidence[]>([]);
  const positions = ref<Map<string, CanvasPosition>>(new Map());
  const operations = ref<Operation[]>([]);
  const viewMode = ref<'raw' | 'simplified'>('raw');
  const selectedLocusId = ref<string | null>(null);
  const selectedPair = ref<{ from: string; to: string } | null>(null);
  const cycleError = ref<{ message: string; path: string[] } | null>(null);
  const consistencyWarning = ref<string | null>(null);
  const toast = ref('');

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(message: string) {
    toast.value = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.value = ''), 4000);
  }

  const pid = () => {
    if (!currentProject.value) throw new Error('尚未打开工程');
    return currentProject.value.id;
  };

  // ---------- 派生图状态（只含有效 earlier 关系） ----------
  const graph = computed(() => buildDirectedGraph(loci.value, relations.value));
  const transitivePairs = computed(() => findTransitivePairs(graph.value));
  const conflictComponents = computed(() =>
    stronglyConnectedComponents(graph.value).filter((c) => c.length > 1),
  );
  const conflictNodes = computed(() => new Set(conflictComponents.value.flat()));
  const locusById = computed(() => new Map(loci.value.map((l) => [l.id, l])));
  const evidenceById = computed(() => new Map(evidences.value.map((e) => [e.id, e])));
  const codeOf = (id: string) => locusById.value.get(id)?.code ?? '？';

  const isolatedLocusIds = computed(() => {
    const connected = new Set<string>();
    for (const r of relations.value) {
      if (r.status !== 'active') continue;
      connected.add(r.fromId);
      connected.add(r.toId);
    }
    return new Set(loci.value.filter((l) => !connected.has(l.id)).map((l) => l.id));
  });

  /** 画布上可见的关系：简化视图只隐藏传递边，不删除任何记录 */
  const visibleRelations = computed(() =>
    relations.value.filter((r) => {
      if (r.status !== 'active') return false;
      if (r.kind === 'contemporary') return true;
      if (viewMode.value === 'simplified' && transitivePairs.value.has(pairKey(r.fromId, r.toId)))
        return false;
      return true;
    }),
  );

  const latestUndoableOperation = computed(
    () =>
      [...operations.value].filter((o) => !o.undone).sort((a, b) => b.at - a.at)[0] ?? null,
  );

  // ---------- 工程载入 ----------
  async function loadProjects() {
    projects.value = await db.projects.orderBy('createdAt').toArray();
  }

  async function openProject(id: string) {
    const project = await db.projects.get(id);
    if (!project) return;
    currentProject.value = project;
    const [ls, rs, es, ps, ops] = await Promise.all([
      db.loci.where('projectId').equals(id).toArray(),
      db.relations.where('projectId').equals(id).toArray(),
      db.evidences.where('projectId').equals(id).toArray(),
      db.positions.where('projectId').equals(id).toArray(),
      db.operations.where('projectId').equals(id).toArray(),
    ]);
    loci.value = ls;
    relations.value = rs;
    evidences.value = es;
    positions.value = new Map(ps.map((p) => [p.locusId, p]));
    operations.value = ops;
    selectedLocusId.value = null;
    selectedPair.value = null;
    cycleError.value = null;
    consistencyWarning.value = null;
  }

  async function reload() {
    if (currentProject.value) await openProject(currentProject.value.id);
  }

  async function createProject(name: string) {
    const project: Project = { id: uid(), name, createdAt: Date.now() };
    await db.projects.add(project);
    projects.value.push(project);
    await openProject(project.id);
  }

  async function seedExample() {
    const id = await seedExampleProject();
    await loadProjects();
    await openProject(id);
    showToast('已载入示例工程（含切割事件、孤立层位与矛盾记录）');
  }

  // ---------- 操作日志（撤销的基础） ----------
  async function recordOperation(label: string, actions: UndoAction[]) {
    const op: Operation = { id: uid(), projectId: pid(), label, at: Date.now(), undone: false, actions };
    await db.operations.add(op);
    operations.value.push(op);
  }

  // ---------- 层位 ----------
  async function addLocus(input: { code: string; kind: LocusKind; label: string; note: string }) {
    const locus: Locus = { id: uid(), projectId: pid(), createdAt: Date.now(), ...input };
    await db.loci.add(locus);
    loci.value.push(locus);
    await recordOperation(`新增层位 ${locus.code}`, [{ type: 'deleteLocus', locusId: locus.id }]);
  }

  // ---------- 证据 ----------
  async function addEvidence(input: { title: string; type: Evidence['type']; text: string }) {
    const evidence: Evidence = { id: uid(), projectId: pid(), createdAt: Date.now(), ...input };
    await db.evidences.add(evidence);
    evidences.value.push(evidence);
    await recordOperation(`新增证据《${evidence.title}》`, [
      { type: 'deleteEvidence', evidenceId: evidence.id },
    ]);
  }

  /** 被任何关系（含已撤销）引用的证据不允许删除，保证证据链完整 */
  async function deleteEvidence(id: string) {
    const used = relations.value.filter((r) => r.evidenceIds.includes(id)).length;
    if (used > 0) {
      consistencyWarning.value = `该证据仍被 ${used} 条关系记录引用（含已撤销判断），不能删除`;
      return;
    }
    const ev = evidences.value.find((e) => e.id === id);
    if (!ev) return;
    await db.evidences.delete(id);
    evidences.value = evidences.value.filter((e) => e.id !== id);
    await recordOperation(`删除证据《${ev.title}》`, [
      { type: 'restoreEvidence', evidence: { ...ev } },
    ]);
  }

  // ---------- 关系 ----------
  async function addRelation(input: {
    kind: RelationKind;
    fromId: string;
    toId: string;
    source: RelationSource;
    evidenceIds: string[];
    note: string;
  }): Promise<boolean> {
    cycleError.value = null;
    consistencyWarning.value = null;

    if (input.fromId === input.toId) {
      cycleError.value = { message: '不能与自身建立关系', path: [input.fromId] };
      return false;
    }

    if (input.kind === 'earlier') {
      // 成环检测：若已存在 to ⇢ from 的路径，新增 from→to 将闭合为环
      const back = findPath(graph.value, input.toId, input.fromId);
      if (back) {
        cycleError.value = {
          message: '新增该先后关系将形成环，与已有记录矛盾。原始记录不会被覆盖，请先核查并撤销冲突判断。',
          path: [input.fromId, ...back],
        };
        return false;
      }
      const contemporary = relations.value.find(
        (r) =>
          r.kind === 'contemporary' &&
          r.status === 'active' &&
          ((r.fromId === input.fromId && r.toId === input.toId) ||
            (r.fromId === input.toId && r.toId === input.fromId)),
      );
      if (contemporary) {
        consistencyWarning.value = `${codeOf(input.fromId)} 与 ${codeOf(input.toId)} 已存在同时期关联，请确认二者是否真的存在先后关系`;
      }
    } else {
      // 同时期关联不进入有向图；若与已有先后路径冲突，仅提示不拦截
      const forward = findPath(graph.value, input.fromId, input.toId);
      const backward = findPath(graph.value, input.toId, input.fromId);
      if (forward || backward) {
        consistencyWarning.value =
          '二者之间已存在有向先后路径，同时期关联与之矛盾；该关联仅作为无向记录保存，不会进入地层矩阵';
      }
    }

    const relation: Relation = {
      id: uid(),
      projectId: pid(),
      status: 'active',
      createdAt: Date.now(),
      revokedAt: null,
      revokeReason: '',
      ...input,
    };
    await db.relations.add(relation);
    relations.value.push(relation);
    const arrow = input.kind === 'earlier' ? '→' : '∥';
    await recordOperation(`新增关系 ${codeOf(input.fromId)} ${arrow} ${codeOf(input.toId)}`, [
      { type: 'deleteRelation', relationId: relation.id },
    ]);
    return true;
  }

  /** 批量撤销判断：一条操作日志携带全部快照，撤销时关系与证据引用一起恢复 */
  async function revokeRelations(ids: string[], reason: string) {
    const targets = relations.value.filter((r) => ids.includes(r.id) && r.status === 'active');
    if (targets.length === 0) return;
    const snapshots = targets.map((r) => ({ ...r, evidenceIds: [...r.evidenceIds] }));
    const now = Date.now();
    await db.transaction('rw', [db.relations, db.operations], async () => {
      for (const r of targets) {
        await db.relations.update(r.id, { status: 'revoked', revokedAt: now, revokeReason: reason });
      }
      await recordOperation(
        `批量撤销 ${targets.length} 条判断`,
        snapshots.map((s) => ({ type: 'restoreRelation' as const, relation: s })),
      );
    });
    for (const r of targets) {
      Object.assign(relations.value.find((x) => x.id === r.id)!, {
        status: 'revoked',
        revokedAt: now,
        revokeReason: reason,
      });
    }
    showToast(`已撤销 ${targets.length} 条判断（记录保留，可随时恢复）`);
  }

  /** 恢复一条已撤销的判断；恢复前同样做成环检测 */
  async function restoreRelationJudgment(id: string): Promise<boolean> {
    const r = relations.value.find((x) => x.id === id);
    if (!r || r.status !== 'revoked') return false;
    cycleError.value = null;
    if (r.kind === 'earlier') {
      const back = findPath(graph.value, r.toId, r.fromId);
      if (back) {
        cycleError.value = {
          message: '恢复该判断将形成环，请先撤销与其矛盾的其他记录。',
          path: [r.fromId, ...back],
        };
        return false;
      }
    }
    const snapshot: Relation = { ...r, evidenceIds: [...r.evidenceIds] };
    await db.relations.update(id, { status: 'active', revokedAt: null, revokeReason: '' });
    Object.assign(r, { status: 'active', revokedAt: null, revokeReason: '' });
    await recordOperation(`恢复判断 ${codeOf(r.fromId)} → ${codeOf(r.toId)}`, [
      { type: 'restoreRelation', relation: snapshot },
    ]);
    return true;
  }

  /** 传递推断：把可达但未记录的层位对补为推断关系（批量、可一次撤销） */
  async function inferTransitiveRelations(): Promise<number> {
    const g = graph.value;
    const known = new Set(
      relations.value.filter((r) => r.kind === 'earlier').map((r) => pairKey(r.fromId, r.toId)),
    );
    const created: Relation[] = [];
    for (const l of loci.value) {
      for (const target of reachableFrom(g, l.id)) {
        const key = pairKey(l.id, target);
        if (known.has(key)) continue;
        known.add(key);
        created.push({
          id: uid(),
          projectId: pid(),
          kind: 'earlier',
          fromId: l.id,
          toId: target,
          source: 'inference',
          status: 'active',
          evidenceIds: [],
          note: '由已有先后关系传递推断',
          createdAt: Date.now(),
          revokedAt: null,
          revokeReason: '',
        });
      }
    }
    if (created.length === 0) return 0;
    await db.relations.bulkAdd(created);
    relations.value.push(...created);
    await recordOperation(
      `传递推断：新增 ${created.length} 条推断关系`,
      created.map((r) => ({ type: 'deleteRelation' as const, relationId: r.id })),
    );
    return created.length;
  }

  // ---------- 撤销 ----------
  async function undoLatest(): Promise<string | null> {
    const op = latestUndoableOperation.value;
    if (!op) return null;
    await db.transaction(
      'rw',
      [db.relations, db.evidences, db.loci, db.positions, db.operations],
      async () => {
        for (const action of [...op.actions].reverse()) {
          switch (action.type) {
            case 'deleteRelation':
              await db.relations.delete(action.relationId);
              break;
            case 'restoreRelation':
              // 完整快照恢复：关系状态与证据引用一起回来
              // （从响应式状态读出的快照需先转为纯数据再入库）
              await db.relations.put(plain(action.relation));
              break;
            case 'deleteEvidence':
              await db.evidences.delete(action.evidenceId);
              break;
            case 'restoreEvidence':
              await db.evidences.put(plain(action.evidence));
              break;
            case 'deleteLocus':
              await db.loci.delete(action.locusId);
              await db.positions.delete([op.projectId, action.locusId]);
              break;
          }
        }
        await db.operations.update(op.id, { undone: true });
      },
    );
    await reload();
    return op.label;
  }

  // ---------- 画布位置（与地层身份分离） ----------
  async function savePosition(locusId: string, x: number, y: number) {
    const pos: CanvasPosition = { projectId: pid(), locusId, x, y };
    await db.positions.put(pos);
    positions.value = new Map(positions.value).set(locusId, pos);
  }

  async function applyAutoLayout() {
    const layout = computeAutoLayout(loci.value, relations.value);
    const rows = layout.map((p) => ({ projectId: pid(), ...p }));
    await db.positions.bulkPut(rows);
    positions.value = new Map(rows.map((p) => [p.locusId, p]));
    showToast('已按地层早晚重新排布（只更新坐标，不改任何记录）');
  }

  // ---------- 导出 / 导入 ----------
  async function exportProject(): Promise<string> {
    const payload = {
      app: 'harris-matrix-workbench',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      project: currentProject.value,
      loci: loci.value,
      positions: [...positions.value.values()],
      relations: relations.value,
      evidences: evidences.value,
      partialOrderSignature: partialOrderSignature(loci.value, relations.value),
    };
    return JSON.stringify(payload, null, 2);
  }

  async function importProject(jsonText: string): Promise<{ ok: boolean; message: string }> {
    let data: any;
    try {
      data = JSON.parse(jsonText);
    } catch {
      return { ok: false, message: '导入失败：文件不是有效的 JSON' };
    }
    if (!data || data.app !== 'harris-matrix-workbench' || !Array.isArray(data.loci) || !Array.isArray(data.relations)) {
      return { ok: false, message: '导入失败：文件格式不正确' };
    }

    // 全部重新分配 id，避免与库中已有工程冲突；层位编号不变，偏序签名可比
    const newPid = uid();
    const idMap = new Map<string, string>();
    const mapId = (old: string) => {
      if (!idMap.has(old)) idMap.set(old, uid());
      return idMap.get(old)!;
    };

    const newLoci: Locus[] = data.loci.map((l: any) => ({ ...l, id: mapId(l.id), projectId: newPid }));
    const newEvidences: Evidence[] = (data.evidences ?? []).map((e: any) => ({
      ...e,
      id: mapId(e.id),
      projectId: newPid,
    }));
    const newRelations: Relation[] = data.relations.map((r: any) => ({
      ...r,
      id: uid(),
      projectId: newPid,
      fromId: mapId(r.fromId),
      toId: mapId(r.toId),
      evidenceIds: (r.evidenceIds ?? []).map((e: string) => mapId(e)),
    }));
    const newPositions: CanvasPosition[] = (data.positions ?? []).map((p: any) => ({
      projectId: newPid,
      locusId: mapId(p.locusId),
      x: p.x,
      y: p.y,
    }));
    const project: Project = {
      id: newPid,
      name: `${data.project?.name ?? '未命名工程'}（导入）`,
      createdAt: Date.now(),
    };

    await db.transaction(
      'rw',
      [db.projects, db.loci, db.relations, db.evidences, db.positions],
      async () => {
        await db.projects.add(project);
        await db.loci.bulkAdd(newLoci);
        await db.evidences.bulkAdd(newEvidences);
        await db.relations.bulkAdd(newRelations);
        await db.positions.bulkPut(newPositions);
      },
    );
    await loadProjects();
    await openProject(newPid);

    const unchanged = partialOrderSignature(newLoci, newRelations) === data.partialOrderSignature;
    return {
      ok: true,
      message: unchanged
        ? `已导入「${project.name}」：${newLoci.length} 个层位 / ${newRelations.length} 条关系，偏序校验一致 ✓`
        : '已导入，但偏序签名与导出时不一致，请核查数据',
    };
  }

  return {
    // state
    projects,
    currentProject,
    loci,
    relations,
    evidences,
    positions,
    operations,
    viewMode,
    selectedLocusId,
    selectedPair,
    cycleError,
    consistencyWarning,
    toast,
    // derived
    graph,
    transitivePairs,
    conflictComponents,
    conflictNodes,
    isolatedLocusIds,
    visibleRelations,
    latestUndoableOperation,
    locusById,
    evidenceById,
    codeOf,
    // actions
    showToast,
    loadProjects,
    openProject,
    createProject,
    seedExample,
    addLocus,
    addEvidence,
    deleteEvidence,
    addRelation,
    revokeRelations,
    restoreRelationJudgment,
    inferTransitiveRelations,
    undoLatest,
    savePosition,
    applyAutoLayout,
    exportProject,
    importProject,
  };
});
