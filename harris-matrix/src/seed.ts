import { db } from './db';
import type { Evidence, Locus, Relation } from './types';
import { computeAutoLayout } from './graph/engine';
import { uid } from './utils';

/**
 * 示例工程：后岗遗址 T0302 东壁。
 * 故意包含：
 *  - 切割事件：H1 灰坑打破 (3)(4)，M1 墓葬打破 (5)；
 *  - 孤立层位：J1 井未清理到底，没有任何关系记录；
 *  - 互相矛盾的原始记录：(3) 与 H1① 的叠压方向两位记录员记反了；
 *  - 一条已撤销的判断与一条推断关系；
 *  - 一条同时期关联（无向，不进矩阵）。
 */
export async function seedExampleProject(): Promise<string> {
  const projectId = uid();
  const now = Date.now();

  const locus = (
    id: string,
    code: string,
    kind: Locus['kind'],
    label: string,
    note = '',
  ): Locus => ({ id, projectId, code, kind, label, note, createdAt: now });

  const loci: Locus[] = [
    locus('L1', '(1)', 'deposit', '表土层'),
    locus('L2', '(2)', 'deposit', '扰土层'),
    locus('L3', '(3)', 'deposit', '灰褐色堆积'),
    locus('L4', '(4)', 'deposit', '红烧土堆积'),
    locus('L5', '(5)', 'deposit', '青灰土堆积'),
    locus('L6', '(6)', 'deposit', '生土层'),
    locus('LH1', 'H1', 'cut', '灰坑坑口', '打破 (3)(4)，被 (2) 叠压'),
    locus('LH1F', 'H1①', 'fill', '灰坑填土'),
    locus('LM1', 'M1', 'cut', '墓葬墓口', '打破 (5)'),
    locus('LM1F', 'M1①', 'fill', '墓内填土'),
    locus('LJ1', 'J1', 'cut', '井（未清理）', '未清理到底，层位关系不明'),
  ];

  const evidence = (
    id: string,
    title: string,
    type: Evidence['type'],
    text: string,
  ): Evidence => ({ id, projectId, title, type, text, createdAt: now });

  const evidences: Evidence[] = [
    evidence('E1', '剖面图 P-07（T0302 东壁）', 'section', '东壁剖面 1:20 实测图，标注 (1)–(6) 及 H1 开口线。'),
    evidence('E2', '发掘日记 2026-07-14', 'note', '清理 (2) 下缘，确认其叠压 H1① 填土。'),
    evidence('E3', '照片 IMG_2031：H1 坑口平面', 'photo', 'H1 开口平面，可见打破 (4) 红烧土面。'),
    evidence('E4', '记录员乙田野笔记（2026-07-15）', 'note', 'M1 打破 (5)；另记「H1① 似叠压 (3)」，与剖面图 P-07 矛盾。'),
    evidence('E5', '陶片类型学比对记录', 'note', 'H1① 与 M1① 出土陶片风格一致，疑为同一时期。'),
  ];

  const rel = (
    id: string,
    fromId: string,
    toId: string,
    note: string,
    evidenceIds: string[],
    extra: Partial<Relation> = {},
  ): Relation => ({
    id,
    projectId,
    kind: 'earlier',
    fromId,
    toId,
    source: 'observation',
    status: 'active',
    evidenceIds,
    note,
    createdAt: now,
    revokedAt: null,
    revokeReason: '',
    ...extra,
  });

  const relations: Relation[] = [
    rel('R1', 'L6', 'L5', '(6) 生土上直接堆积 (5)', ['E2']),
    rel('R2', 'L5', 'L4', '(5) 上叠压 (4)', ['E2']),
    rel('R3', 'L4', 'L3', '(4) 上叠压 (3)', ['E1']),
    rel('R4', 'L3', 'L2', '(3) 上叠压 (2)', ['E1']),
    rel('R5', 'L2', 'L1', '(2) 上为现代表土 (1)', ['E1']),
    rel('R6', 'L4', 'LH1', 'H1 打破 (4) 红烧土面', ['E1', 'E3']),
    rel('R7', 'L3', 'LH1', 'H1 打破 (3)', ['E1']),
    rel('R8', 'LH1', 'LH1F', 'H1① 为 H1 坑内填土', ['E3']),
    rel('R9', 'LH1F', 'L2', 'H1① 被 (2) 叠压', ['E2']),
    rel('R10', 'L5', 'LM1', 'M1 打破 (5)', ['E4']),
    rel('R11', 'LM1', 'LM1F', 'M1① 为墓内填土', ['E4']),
    rel('R12', 'LM1F', 'L4', 'M1① 被 (4) 叠压', ['E4']),
    // —— 互相矛盾的原始记录（两条都保留，等待核查撤销其一）——
    rel('R13', 'L3', 'LH1F', '剖面记录 P-07：(3) 叠压 H1①', ['E1']),
    rel('R14', 'LH1F', 'L3', '记录员乙笔记：H1① 叠压 (3)（与 P-07 矛盾）', ['E4']),
    // —— 推断关系 ——
    rel('R15', 'L5', 'L3', '由 (5)→(4)→(3) 传递推断', [], { source: 'inference' }),
    // —— 已撤销的判断（分开保存，不进图）——
    rel('R16', 'LH1F', 'L1', '初判 H1① 被 (1) 直接叠压', ['E1'], {
      status: 'revoked',
      revokedAt: now,
      revokeReason: '复查剖面 P-07：二者之间隔有 (2)，原判断不成立',
    }),
    // —— 同时期关联：无向记录，不能当作有向边 ——
    rel('R17', 'LH1F', 'LM1F', '出土陶片风格一致，疑为同时期', ['E5'], { kind: 'contemporary' }),
  ];

  const positions = computeAutoLayout(loci, relations).map((p) => ({
    projectId,
    ...p,
  }));

  await db.transaction(
    'rw',
    [db.projects, db.loci, db.relations, db.evidences, db.positions],
    async () => {
      await db.projects.add({ id: projectId, name: '示例：后岗遗址 T0302 东壁', createdAt: now });
      await db.loci.bulkAdd(loci);
      await db.evidences.bulkAdd(evidences);
      await db.relations.bulkAdd(relations);
      await db.positions.bulkPut(positions);
    },
  );
  return projectId;
}
