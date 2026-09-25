<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '../store/project';

const store = useProjectStore();

const ops = computed(() => [...store.operations].sort((a, b) => b.at - a.at));

function fmt(at: number) {
  return new Date(at).toLocaleString('zh-CN', { hour12: false });
}

async function undo() {
  const label = await store.undoLatest();
  if (label) store.showToast(`已撤销：${label}`);
}
</script>

<template>
  <div class="panel">
    <h2>操作记录</h2>
    <button class="undo-btn" :disabled="!store.latestUndoableOperation" @click="undo">
      撤销最近操作{{ store.latestUndoableOperation ? `：${store.latestUndoableOperation.label}` : '' }}
    </button>
    <p class="hint">撤销按逆操作快照执行：批量操作会被整体回滚，关系与其证据引用一起恢复。</p>
    <ul class="op-list">
      <li v-for="op in ops" :key="op.id" :class="{ undone: op.undone }">
        <div class="op-head">
          <span class="label">{{ op.label }}</span>
          <span v-if="op.undone" class="badge danger">已撤销</span>
        </div>
        <div class="meta">{{ fmt(op.at) }} · {{ op.actions.length }} 项逆操作</div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.undo-btn { width: 100%; }
.op-list { list-style: none; margin: 10px 0 0; padding: 0; }
.op-list li {
  border: 1px solid #e7e0cf;
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 6px;
  background: #fffdf8;
  font-size: 13px;
}
.op-list li.undone { opacity: 0.55; }
.op-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.meta { font-size: 11px; color: #a89e8a; margin-top: 2px; }
</style>
