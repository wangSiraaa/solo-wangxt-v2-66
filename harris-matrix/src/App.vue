<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProjectStore } from './store/project';
import MatrixView from './components/MatrixView.vue';
import LocusPanel from './components/LocusPanel.vue';
import RelationPanel from './components/RelationPanel.vue';
import EvidencePanel from './components/EvidencePanel.vue';
import OperationLog from './components/OperationLog.vue';

const store = useProjectStore();
const fileInput = ref<HTMLInputElement>();
const tab = ref<'relations' | 'evidence' | 'ops'>('relations');

const tabs = [
  { key: 'relations' as const, label: '关系' },
  { key: 'evidence' as const, label: '证据' },
  { key: 'ops' as const, label: '操作' },
];

onMounted(async () => {
  await store.loadProjects();
  if (store.projects.length === 0) await store.seedExample();
  else await store.openProject(store.projects[0].id);
});

async function onSwitchProject(e: Event) {
  await store.openProject((e.target as HTMLSelectElement).value);
}

async function onNewProject() {
  const name = window.prompt('新工程名称', '');
  if (name?.trim()) await store.createProject(name.trim());
}

async function onSeed() {
  await store.seedExample();
}

async function onAutoLayout() {
  await store.applyAutoLayout();
}

async function onInfer() {
  const n = await store.inferTransitiveRelations();
  store.showToast(n > 0 ? `已新增 ${n} 条推断关系（可一次撤销）` : '没有可推断的新关系');
}

async function onUndo() {
  const label = await store.undoLatest();
  if (label) store.showToast(`已撤销：${label}`);
}

async function onExport() {
  const json = await store.exportProject();
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${store.currentProject?.name ?? 'harris-matrix'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  store.showToast('已导出 JSON（含偏序签名，导入时将校验）');
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  const res = await store.importProject(text);
  store.showToast(res.message);
  input.value = '';
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <h1>地层矩阵编辑台</h1>
        <span class="privacy">🔒 纯浏览器运行 · 现场资料只存本机 IndexedDB，不上传</span>
      </div>
      <div class="bar">
        <select :value="store.currentProject?.id" @change="onSwitchProject">
          <option v-for="p in store.projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button @click="onNewProject">新建工程</button>
        <button @click="onSeed">载入示例</button>
        <button @click="onExport">导出</button>
        <button @click="fileInput?.click()">导入</button>
        <input ref="fileInput" type="file" accept="application/json" hidden @change="onImport" />
      </div>
      <div class="bar">
        <span class="lbl">视图：</span>
        <label><input v-model="store.viewMode" type="radio" value="raw" /> 原始关系</label>
        <label><input v-model="store.viewMode" type="radio" value="simplified" /> 简化矩阵（仅隐藏传递边）</label>
        <button @click="onAutoLayout">自动排布</button>
        <button @click="onInfer">传递推断</button>
        <button :disabled="!store.latestUndoableOperation" @click="onUndo">
          撤销{{ store.latestUndoableOperation ? `：${store.latestUndoableOperation.label}` : '' }}
        </button>
      </div>
    </header>

    <div v-if="store.conflictComponents.length" class="conflict-banner">
      ⚠ 检测到 {{ store.conflictComponents.length }} 组互相矛盾的记录：
      <span v-for="(comp, i) in store.conflictComponents" :key="i" class="conflict-chip">
        {{ comp.map(store.codeOf).join(' ⇄ ') }}
      </span>
      原始记录均已保留，请在「关系」页核查并撤销其中之一。
    </div>

    <main class="layout">
      <aside class="left"><LocusPanel /></aside>
      <section class="center"><MatrixView /></section>
      <aside class="right">
        <div class="tabs">
          <button
            v-for="t in tabs"
            :key="t.key"
            :class="{ active: tab === t.key }"
            @click="tab = t.key"
          >
            {{ t.label }}
          </button>
        </div>
        <RelationPanel v-show="tab === 'relations'" />
        <EvidencePanel v-show="tab === 'evidence'" />
        <OperationLog v-show="tab === 'ops'" />
      </aside>
    </main>

    <div v-if="store.toast" class="toast">{{ store.toast }}</div>
  </div>
</template>
