/**
 * 领域模型：地层身份与画布位置严格分离。
 * - Locus 只保存考古学身份（编号、类型、名称），不含任何坐标。
 * - CanvasPosition 单独成表，仅描述节点在画布上的位置。
 */

export type LocusKind = 'deposit' | 'cut' | 'fill';

/** 层位（堆积单位）：堆积 / 切割 / 填充 */
export interface Locus {
  id: string;
  projectId: string;
  code: string; // 层位编号，如 (3)、H1、M1①
  kind: LocusKind;
  label: string; // 名称，如「灰褐色堆积」
  note: string;
  createdAt: number;
}

/** 画布位置（与地层身份分离，拖动节点只改这张表） */
export interface CanvasPosition {
  projectId: string;
  locusId: string;
  x: number;
  y: number;
}

/**
 * 关系类型：
 * - earlier：先后关系（from 早于 to），唯一会进入有向图的关系；
 * - contemporary：同时期关联，只是无向记录，绝不能当成有向边。
 */
export type RelationKind = 'earlier' | 'contemporary';

/** 关系来源：现场原始观察 / 事后推断 */
export type RelationSource = 'observation' | 'inference';

/** 判断状态：有效 / 已撤销（撤销不删除，分开保存） */
export type RelationStatus = 'active' | 'revoked';

export interface Relation {
  id: string;
  projectId: string;
  kind: RelationKind;
  fromId: string;
  toId: string;
  source: RelationSource;
  status: RelationStatus;
  evidenceIds: string[]; // 证据引用，随关系一起保存/恢复
  note: string;
  createdAt: number;
  revokedAt: number | null;
  revokeReason: string;
}

/** 证据：照片、笔记、剖面图等原始记录 */
export interface Evidence {
  id: string;
  projectId: string;
  title: string;
  type: 'photo' | 'note' | 'section' | 'drawing';
  text: string;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
}

/** 撤销动作为完整快照，保证撤销后关系与证据引用一起恢复 */
export type UndoAction =
  | { type: 'deleteRelation'; relationId: string }
  | { type: 'restoreRelation'; relation: Relation }
  | { type: 'deleteEvidence'; evidenceId: string }
  | { type: 'restoreEvidence'; evidence: Evidence }
  | { type: 'deleteLocus'; locusId: string };

/** 一条操作日志 = 一次（可批量）命令 + 其逆操作集合 */
export interface Operation {
  id: string;
  projectId: string;
  label: string;
  at: number;
  undone: boolean;
  actions: UndoAction[];
}
