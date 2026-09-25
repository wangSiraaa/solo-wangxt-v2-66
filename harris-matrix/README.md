# 地层矩阵编辑台（Harris Matrix Workbench）

面向考古记录员的纯浏览器地层矩阵编辑工具：把堆积、切割、填充关系整理为可检查的地层矩阵。
所有数据只保存在本机 IndexedDB，**不上传任何现场资料**。

## 运行

```bash
npm install
npm run dev        # 开发
npm run build      # 类型检查 + 生产构建
npm run verify     # 图引擎与 store 逻辑验证（无需浏览器）
```

首次打开自动载入示例工程「后岗遗址 T0302 东壁」，其中故意包含：

- **切割事件**：H1 灰坑打破 (3)(4)、M1 墓葬打破 (5)；
- **孤立层位**：J1 井未清理到底，没有任何关系记录（画布上橙色虚线框）；
- **互相矛盾的记录**：(3) 与 H1① 的叠压方向被两位记录员记反，顶部出现红色警示条，
  原始记录全部保留，核查后撤销其中之一即可；
- 一条**已撤销判断**、一条**推断关系**、一条**同时期关联**（绿色点线，无向）。

## 技术栈与设计

Vue 3 + TypeScript；Graphology 管理有向关系；Cytoscape.js 绘制矩阵；Dexie 持久化 IndexedDB。

```
src/
├── types.ts            领域模型：层位 / 关系 / 证据 / 操作日志
├── db.ts               Dexie（IndexedDB）表结构
├── graph/engine.ts     有向图算法：成环检测、传递边、SCC、分层、偏序签名
├── store/project.ts    Pinia store：命令、撤销、导入导出
├── seed.ts             示例工程
└── components/         MatrixView（画布）、LocusPanel、RelationPanel、EvidencePanel、OperationLog
```

### 关键约束的实现位置

| 需求 | 实现 |
| --- | --- |
| 地层身份与画布位置分离 | `Locus` 不含坐标；`CanvasPosition` 独立成表，拖动节点只写这张表 |
| 新增关系成环检测并定位路径 | `store.addRelation` 先 `findPath(to→from)`，命中即拒绝并展示完整冲突路径 |
| 同时期关联不能当有向边 | `kind: 'contemporary'` 从不进入 `buildDirectedGraph`，画布上为无向绿点线 |
| 原始观察 / 推断 / 已撤销分开保存 | `Relation.source` + `Relation.status`，右侧面板分组列出 |
| 简化只隐藏传递边 | `findTransitivePairs` 标记传递边，简化视图仅过滤显示，库中记录不动 |
| 撤销批量操作，证据引用一起恢复 | 操作日志存完整快照（`restoreRelation`），`undoLatest` 整体回滚 |
| 导出再导入不改变偏序 | 导出附 `partialOrderSignature`（按层位编号的可达集），导入重算比对 |
| 矛盾记录可检查 | Tarjan SCC 检出大小 >1 的分量，横幅 + 节点红框提示 |

### 数据不出本机

无任何网络请求；「导出」是浏览器本地下载 JSON，「导入」读取本地文件。
