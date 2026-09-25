<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../store/project';
import type { Evidence } from '../types';

const store = useProjectStore();

const title = ref('');
const type = ref<Evidence['type']>('note');
const text = ref('');

const typeLabel: Record<Evidence['type'], string> = {
  photo: '照片',
  note: '笔记',
  section: '剖面图',
  drawing: '绘图',
};

const sorted = computed(() => [...store.evidences].sort((a, b) => b.createdAt - a.createdAt));

function refCount(id: string) {
  return store.relations.filter((r) => r.evidenceIds.includes(id)).length;
}

async function submit() {
  if (!title.value.trim()) return;
  await store.addEvidence({ title: title.value.trim(), type: type.value, text: text.value.trim() });
  title.value = '';
  text.value = '';
}

async function remove(id: string) {
  await store.deleteEvidence(id);
}
</script>

<template>
  <div class="panel">
    <h2>证据（{{ store.evidences.length }}）</h2>
    <form class="form" @submit.prevent="submit">
      <div class="row">
        <input v-model="title" placeholder="标题，如 照片 IMG_2040" required />
        <select v-model="type">
          <option value="photo">照片</option>
          <option value="note">笔记</option>
          <option value="section">剖面图</option>
          <option value="drawing">绘图</option>
        </select>
      </div>
      <textarea v-model="text" rows="2" placeholder="内容摘要"></textarea>
      <button type="submit">保存证据</button>
    </form>

    <ul class="evidence-list">
      <li v-for="e in sorted" :key="e.id">
        <div class="ev-head">
          <span class="badge type">{{ typeLabel[e.type] }}</span>
          <strong>{{ e.title }}</strong>
          <span class="refs">被引用 {{ refCount(e.id) }} 次</span>
          <button
            class="small"
            :disabled="refCount(e.id) > 0"
            :title="refCount(e.id) > 0 ? '仍被关系记录引用，不能删除' : '删除该证据'"
            @click="remove(e.id)"
          >
            删除
          </button>
        </div>
        <p v-if="e.text" class="text">{{ e.text }}</p>
      </li>
    </ul>
    <p class="hint">被任何关系（含已撤销判断）引用的证据不可删除，保证原始证据链完整。</p>
  </div>
</template>

<style scoped>
.evidence-list { list-style: none; margin: 10px 0 0; padding: 0; }
.evidence-list li {
  border: 1px solid #e7e0cf;
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 6px;
  background: #fffdf8;
  font-size: 13px;
}
.ev-head { display: flex; gap: 8px; align-items: center; }
.ev-head strong { flex: 1; min-width: 0; }
.badge.type { background: #8b5e34; color: #fff; }
.refs { font-size: 11px; color: #a89e8a; }
.text { margin: 4px 0 0; font-size: 12px; color: #6b6252; }
</style>
