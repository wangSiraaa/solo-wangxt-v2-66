<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../store/project';
import type { Relation, RelationKind, RelationSource } from '../types';

const store = useProjectStore();

const kind = ref<RelationKind>('earlier');
const fromId = ref('');
const toId = ref('');
const source = ref<RelationSource>('observation');
const note = ref('');
const pickedEvidence = ref<string[]>([]);

const selected = ref<Set<string>>(new Set());
const batchReason = ref('');

async function submit() {
  if (!fromId.value || !toId.value) return;
  const ok = await store.addRelation({
    kind: kind.value,
    fromId: fromId.value,
    toId: toId.value,
    source: source.value,
    evidenceIds: [...pickedEvidence.value],
    note: note.value.trim(),
  });
  if (ok) {
    note.value = '';
    pickedEvidence.value = [];
  }
}

/** 原始观察 / 推断 / 已撤销 分开列出 */
const filtered = computed(() => {
  let list = [...store.relations].sort((a, b) => b.createdAt - a.createdAt);
  const pair = store.selectedPair;
  if (pair) {
    list = list.filter(
      (r) =>
        (r.fromId === pair.from && r.toId === pair.to) ||
        (r.fromId === pair.to && r.toId === pair.from),
    );
  }
  return list;
});

const groups = computed(() => [
  {
    title: '原始观察',
    items: filtered.value.filter((r) => r.status === 'active' && r.source === 'observation'),
  },
  {
    title: '推断关系',
    items: filtered.value.filter((r) => r.status === 'active' && r.source === 'inference'),
  },
  {
    title: '已撤销判断（保留备查）',
    items: filtered.value.filter((r) => r.status === 'revoked'),
  },
]);

function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

async function revokeOne(id: string) {
  const reason = window.prompt('撤销理由（该判断保留为已撤销记录，不会删除）', '');
  if (reason === null) return;
  await store.revokeRelations([id], reason || '未填写理由');
}

async function revokeSelected() {
  await store.revokeRelations([...selected.value], batchReason.value || '未填写理由');
  selected.value = new Set();
  batchReason.value = '';
}

async function restoreOne(id: string) {
  await store.restoreRelationJudgment(id);
}

function evidenceTitle(r: Relation, eid: string) {
  return store.evidenceById.get(eid)?.title ?? '（证据已删除）';
}
</script>

<template>
  <div class="panel">
    <h2>新增关系</h2>
    <form class="form" @submit.prevent="submit">
      <div class="row">
        <label><input v-model="kind" type="radio" value="earlier" /> 先后（有向）</label>
        <label><input v-model="kind" type="radio" value="contemporary" /> 同时期（无向）</label>
      </div>
      <div class="row">
        <select v-model="fromId" required>
          <option value="" disabled>选择层位</option>
          <option v-for="l in store.loci" :key="l.id" :value="l.id">{{ l.code }} {{ l.label }}</option>
        </select>
        <span class="arrow">{{ kind === 'earlier' ? '早于' : '同期' }}</span>
        <select v-model="toId" required>
          <option value="" disabled>选择层位</option>
          <option v-for="l in store.loci" :key="l.id" :value="l.id">{{ l.code }} {{ l.label }}</option>
        </select>
      </div>
      <div v-if="kind === 'earlier'" class="row">
        <label><input v-model="source" type="radio" value="observation" /> 现场观察</label>
        <label><input v-model="source" type="radio" value="inference" /> 推断</label>
      </div>
      <details class="evidence-picker">
        <summary>关联证据（已选 {{ pickedEvidence.length }}）</summary>
        <label v-for="e in store.evidences" :key="e.id">
          <input v-model="pickedEvidence" type="checkbox" :value="e.id" /> {{ e.title }}
        </label>
      </details>
      <input v-model="note" placeholder="备注（如剖面位置、判断依据）" />
      <button type="submit">保存关系</button>
    </form>

    <div v-if="store.cycleError" class="alert danger">
      <strong>成环检测：</strong>{{ store.cycleError.message }}
      <div class="cycle-path">
        冲突路径：{{ store.cycleError.path.map(store.codeOf).join(' → ') }}
      </div>
    </div>
    <div v-if="store.consistencyWarning" class="alert warn">⚠ {{ store.consistencyWarning }}</div>

    <div v-if="store.selectedPair" class="filter-chip">
      只看 {{ store.codeOf(store.selectedPair.from) }} 与 {{ store.codeOf(store.selectedPair.to) }} 之间的记录
      <button class="link" @click="store.selectedPair = null">×</button>
    </div>

    <div v-if="selected.size > 0" class="batch-bar">
      <span>已选 {{ selected.size }} 条</span>
      <input v-model="batchReason" placeholder="撤销理由" />
      <button @click="revokeSelected">批量撤销</button>
    </div>

    <section v-for="g in groups" :key="g.title" class="group">
      <h3>{{ g.title }}（{{ g.items.length }}）</h3>
      <p v-if="g.items.length === 0" class="empty">暂无记录</p>
      <ul>
        <li v-for="r in g.items" :key="r.id" class="relation">
          <input
            v-if="r.status === 'active'"
            type="checkbox"
            class="pick"
            :checked="selected.has(r.id)"
            @change="toggle(r.id)"
          />
          <div class="rel-main">
            <div class="rel-head">
              <span class="codes">
                {{ store.codeOf(r.fromId) }} {{ r.kind === 'earlier' ? '→' : '∥' }}
                {{ store.codeOf(r.toId) }}
              </span>
              <span class="badge" :data-source="r.source">{{ r.source === 'observation' ? '观察' : '推断' }}</span>
              <span v-if="r.kind === 'contemporary'" class="badge cont">同时期</span>
              <span v-if="r.status === 'revoked'" class="badge danger">已撤销</span>
            </div>
            <div v-if="r.note" class="note">{{ r.note }}</div>
            <div v-if="r.evidenceIds.length" class="evidence">
              证据：
              <span v-for="eid in r.evidenceIds" :key="eid" class="chip">{{ evidenceTitle(r, eid) }}</span>
            </div>
            <div v-if="r.status === 'revoked'" class="note">撤销理由：{{ r.revokeReason || '—' }}</div>
          </div>
          <button v-if="r.status === 'active'" class="small" @click="revokeOne(r.id)">撤销</button>
          <button v-else class="small" @click="restoreOne(r.id)">恢复</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.arrow { color: #8b5e34; font-weight: 700; }
.evidence-picker {
  border: 1px solid #ddd5c3;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
}
.evidence-picker label { display: block; padding: 2px 0; }
.cycle-path {
  margin-top: 6px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  word-break: break-all;
}
.filter-chip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #e4dcc8;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  margin: 8px 0;
}
.batch-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  background: #f6e8e4;
  border: 1px solid #d9a79b;
  border-radius: 6px;
  padding: 6px 10px;
  margin: 8px 0;
  font-size: 13px;
}
.batch-bar input { flex: 1; }
.group { margin-top: 14px; }
.group h3 { font-size: 13px; color: #6b6252; margin: 0 0 6px; }
.group ul { list-style: none; margin: 0; padding: 0; }
.relation {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px;
  border: 1px solid #e7e0cf;
  border-radius: 6px;
  margin-bottom: 6px;
  background: #fffdf8;
  font-size: 13px;
}
.pick { margin-top: 3px; }
.rel-main { flex: 1; min-width: 0; }
.rel-head { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.codes { font-weight: 700; }
.note { color: #6b6252; font-size: 12px; margin-top: 2px; }
.evidence { font-size: 12px; color: #6b6252; margin-top: 2px; }
.chip {
  display: inline-block;
  background: #efe8d8;
  border-radius: 8px;
  padding: 0 6px;
  margin: 1px 2px;
}
.badge[data-source='observation'] { background: #6d8fb3; color: #fff; }
.badge[data-source='inference'] { background: #95a5a6; color: #fff; }
.badge.cont { background: #3d9970; color: #fff; }
.empty { font-size: 12px; color: #a89e8a; margin: 0; }
</style>
