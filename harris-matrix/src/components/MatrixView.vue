<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import cytoscape, { type Core, type EventObject, type StylesheetJson } from 'cytoscape';
import { useProjectStore } from '../store/project';
import { pairKey } from '../graph/engine';

const store = useProjectStore();
const container = ref<HTMLDivElement>();
let cy: Core | null = null;

const stylesheet: StylesheetJson = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'font-size': 9,
      'font-weight': 600,
      color: '#fff',
      'text-outline-width': 0,
      width: 74,
      height: 40,
      'border-width': 2,
      'border-color': 'rgba(0,0,0,0.15)',
    },
  },
  { selector: 'node[kind="deposit"]', style: { shape: 'round-rectangle', 'background-color': '#6d8fb3' } },
  { selector: 'node[kind="cut"]', style: { shape: 'diamond', 'background-color': '#b3564d', width: 64, height: 48, 'font-size': 8 } },
  { selector: 'node[kind="fill"]', style: { shape: 'rectangle', 'background-color': '#a98a5b' } },
  { selector: 'node.isolated', style: { 'border-style': 'dashed', 'border-color': '#d97b29', 'border-width': 3 } },
  { selector: 'node.conflict', style: { 'border-color': '#c0392b', 'border-width': 4 } },
  { selector: 'node.selected', style: { 'border-color': '#2c3e50', 'border-width': 4 } },
  {
    selector: 'edge.earlier',
    style: {
      width: 2,
      'line-color': '#7f8c8d',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#7f8c8d',
      'arrow-scale': 1.2,
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': 8,
      color: '#95a5a6',
      'text-rotation': 'autorotate',
    },
  },
  { selector: 'edge.inference', style: { 'line-style': 'dashed', 'line-color': '#95a5a6', 'target-arrow-color': '#95a5a6' } },
  { selector: 'edge.transitive', style: { 'line-color': '#c3cbd1', 'target-arrow-color': '#c3cbd1', opacity: 0.75 } },
  {
    selector: 'edge.contemporary',
    style: {
      width: 2,
      'line-style': 'dotted',
      'line-color': '#3d9970',
      'target-arrow-shape': 'none',
      'source-arrow-shape': 'none',
      'curve-style': 'unbundled-bezier',
      'control-point-distances': [40],
      'control-point-weights': [0.5],
    },
  },
];

function buildElements() {
  const elements: cytoscape.ElementDefinition[] = [];
  store.loci.forEach((l, i) => {
    const pos = store.positions.get(l.id);
    const classes = [
      store.isolatedLocusIds.has(l.id) ? 'isolated' : '',
      store.conflictNodes.has(l.id) ? 'conflict' : '',
      store.selectedLocusId === l.id ? 'selected' : '',
    ]
      .filter(Boolean)
      .join(' ');
    elements.push({
      data: { id: l.id, label: `${l.code}\n${l.label}`, kind: l.kind },
      // 画布位置来自独立的 positions 表；没有坐标时给个兜底网格位
      position: pos ? { x: pos.x, y: pos.y } : { x: 100 + (i % 5) * 160, y: 100 + Math.floor(i / 5) * 110 },
      classes,
    });
  });

  // 同一对层位可能有多条记录（不同记录员/证据），画布上聚合为一条边
  const byPair = new Map<string, { count: number; hasObservation: boolean }>();
  for (const r of store.visibleRelations) {
    if (r.kind === 'contemporary') {
      elements.push({
        data: { id: `c-${r.id}`, source: r.fromId, target: r.toId },
        classes: 'contemporary',
      });
      continue;
    }
    const key = pairKey(r.fromId, r.toId);
    const agg = byPair.get(key) ?? { count: 0, hasObservation: false };
    agg.count++;
    agg.hasObservation = agg.hasObservation || r.source === 'observation';
    byPair.set(key, agg);
  }
  for (const [key, agg] of byPair) {
    const [s, t] = key.split('→');
    const transitive = store.transitivePairs.has(key);
    elements.push({
      data: { id: `e-${key}`, source: s, target: t, label: agg.count > 1 ? `×${agg.count}` : '' },
      classes: ['earlier', agg.hasObservation ? 'observation' : 'inference', transitive ? 'transitive' : '']
        .filter(Boolean)
        .join(' '),
    });
  }
  return elements;
}

function rebuild() {
  if (!cy) return;
  const pan = cy.pan();
  const zoom = cy.zoom();
  cy.elements().remove();
  cy.add(buildElements());
  cy.pan(pan);
  cy.zoom(zoom);
}

function fit() {
  cy?.fit(undefined, 50);
}

onMounted(() => {
  cy = cytoscape({
    container: container.value,
    elements: [],
    style: stylesheet,
    layout: { name: 'preset' },
    wheelSensitivity: 0.2,
    boxSelectionEnabled: false,
  });

  cy.on('dragfree', 'node', (evt: EventObject) => {
    const node = evt.target;
    const p = node.position();
    void store.savePosition(node.id(), p.x, p.y);
  });
  cy.on('tap', 'node', (evt: EventObject) => {
    store.selectedLocusId = evt.target.id();
    store.selectedPair = null;
  });
  cy.on('tap', 'edge', (evt: EventObject) => {
    const d = evt.target.data();
    if (typeof d.id === 'string' && d.id.startsWith('e-')) {
      store.selectedPair = { from: d.source, to: d.target };
      store.selectedLocusId = null;
    }
  });
  cy.on('tap', (evt: EventObject) => {
    if (evt.target === cy) {
      store.selectedLocusId = null;
      store.selectedPair = null;
    }
  });

  rebuild();
  fit();
});

watch(
  () => [
    store.loci,
    store.visibleRelations,
    store.positions,
    store.selectedLocusId,
    store.conflictNodes,
    store.isolatedLocusIds,
  ],
  rebuild,
  { deep: true },
);

onBeforeUnmount(() => {
  cy?.destroy();
  cy = null;
});
</script>

<template>
  <div class="matrix-wrap">
    <div ref="container" class="matrix-canvas"></div>
    <button class="fit-btn" @click="fit">适应画布</button>
    <div class="legend">
      <span><i class="sw deposit"></i>堆积</span>
      <span><i class="sw cut"></i>切割</span>
      <span><i class="sw fill"></i>填充</span>
      <span><i class="ln solid"></i>观察</span>
      <span><i class="ln dashed"></i>推断</span>
      <span><i class="ln faint"></i>传递边（简化视图隐藏）</span>
      <span><i class="ln dotted"></i>同时期（无向）</span>
      <span><i class="sw isolated"></i>孤立层位</span>
      <span><i class="sw conflict"></i>矛盾</span>
    </div>
  </div>
</template>

<style scoped>
.matrix-wrap {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.matrix-canvas {
  flex: 1;
  min-height: 0;
  background: #fbf9f4;
  border: 1px solid #ddd5c3;
  border-radius: 8px;
}
.fit-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 8px 4px 0;
  font-size: 12px;
  color: #6b6252;
  align-items: center;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sw {
  width: 12px;
  height: 12px;
  display: inline-block;
  border-radius: 3px;
}
.sw.deposit { background: #6d8fb3; }
.sw.cut { background: #b3564d; transform: rotate(45deg); border-radius: 2px; }
.sw.fill { background: #a98a5b; }
.sw.isolated { background: #fff; border: 2px dashed #d97b29; }
.sw.conflict { background: #fff; border: 3px solid #c0392b; }
.ln {
  width: 22px;
  height: 0;
  display: inline-block;
  border-top: 2px solid #7f8c8d;
}
.ln.dashed { border-top-style: dashed; border-color: #95a5a6; }
.ln.faint { border-color: #c3cbd1; }
.ln.dotted { border-top-style: dotted; border-color: #3d9970; }
</style>
