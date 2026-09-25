<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../store/project';
import type { LocusKind } from '../types';

const store = useProjectStore();

const code = ref('');
const kind = ref<LocusKind>('deposit');
const label = ref('');
const note = ref('');

const kindLabel: Record<LocusKind, string> = { deposit: '堆积', cut: '切割', fill: '填充' };

const sortedLoci = computed(() =>
  [...store.loci].sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true })),
);

async function submit() {
  if (!code.value.trim()) return;
  await store.addLocus({
    code: code.value.trim(),
    kind: kind.value,
    label: label.value.trim(),
    note: note.value.trim(),
  });
  code.value = '';
  label.value = '';
  note.value = '';
}
</script>

<template>
  <div class="panel">
    <h2>层位（{{ store.loci.length }}）</h2>
    <form class="form" @submit.prevent="submit">
      <div class="row">
        <input v-model="code" placeholder="编号，如 (7) / H2" required />
        <select v-model="kind">
          <option value="deposit">堆积</option>
          <option value="cut">切割</option>
          <option value="fill">填充</option>
        </select>
      </div>
      <input v-model="label" placeholder="名称，如 灰坑填土" />
      <input v-model="note" placeholder="备注（可选）" />
      <button type="submit">新增层位</button>
    </form>

    <ul class="locus-list">
      <li
        v-for="l in sortedLoci"
        :key="l.id"
        :class="{ selected: store.selectedLocusId === l.id }"
        @click="store.selectedLocusId = l.id"
      >
        <span class="code">{{ l.code }}</span>
        <span class="kind" :data-kind="l.kind">{{ kindLabel[l.kind] }}</span>
        <span class="label">{{ l.label }}</span>
        <span v-if="store.isolatedLocusIds.has(l.id)" class="badge warn">孤立</span>
        <span v-if="store.conflictNodes.has(l.id)" class="badge danger">矛盾</span>
      </li>
    </ul>
    <p class="hint">层位身份与画布位置分开保存：拖动节点只更新坐标，不改动任何地层记录。</p>
  </div>
</template>

<style scoped>
.locus-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  overflow: auto;
}
.locus-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.locus-list li:hover { background: #f0ebdf; }
.locus-list li.selected { background: #e4dcc8; }
.code { font-weight: 700; min-width: 44px; }
.kind {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  color: #fff;
  background: #6d8fb3;
}
.kind[data-kind='cut'] { background: #b3564d; }
.kind[data-kind='fill'] { background: #a98a5b; }
.label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
