import Dexie, { type Table } from 'dexie';
import type {
  CanvasPosition,
  Evidence,
  Locus,
  Operation,
  Project,
  Relation,
} from './types';

/**
 * 所有数据只写入本机 IndexedDB，不经过任何网络请求。
 */
class HarrisDB extends Dexie {
  projects!: Table<Project, string>;
  loci!: Table<Locus, string>;
  positions!: Table<CanvasPosition, [string, string]>;
  relations!: Table<Relation, string>;
  evidences!: Table<Evidence, string>;
  operations!: Table<Operation, string>;

  constructor() {
    super('harris-matrix');
    this.version(1).stores({
      projects: 'id, createdAt',
      loci: 'id, projectId',
      // 画布位置独立成表：主键 [工程+层位]，与 Locus 表无外键耦合
      positions: '[projectId+locusId], projectId',
      relations: 'id, projectId, status',
      evidences: 'id, projectId',
      operations: 'id, projectId, at',
    });
  }
}

export const db = new HarrisDB();
