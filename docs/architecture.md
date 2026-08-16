# 架构说明

## 分层

```
DSH Web UI（浏览器）
  ├─ 官方 client 插件（EAC 内置，已补丁）
  │    ├─ sidebar.workspaces → 「项目/任务」分组
  │    └─ 工作区选择器 → 「无工作区（任务）」项
  └─ dsh-task-runner client（本插件 /plugins/dsh-task-runner/client.js）
       ├─ window.__dshTaskRunner.{createTask, openPanel, showToast, isTaskDir}
       ├─ 任务面板（命名/列表/清理）
       └─ fetch /task-runner/api/*
            ↓ HTTP POST（同源，信任围栏校验）
DSH Host（Node）
  └─ dsh-task-runner host（本插件 lib/index.js）
       ├─ TaskRegistry（lib/registry.js，清单 .tasks.json）
       ├─ /task-runner/api/*（allocate/list/attach/rename/cleanup）
       ├─ /task 命令
       └─ 会话钩子（session/created → 登记；session/disposed → 回收）
            ↓ session.create({ cwd })（原生 RPC，不 attach 工作区）
DSH Session/Agent
```

## 任务创建流程

1. 用户在官方选择器点「无工作区（任务）」或任务组「+」→ `createTask()`
2. client 调 `task.allocate` → host 在 `D:\dsh_working\<名称>-<时间戳>` 建目录并登记
3. client 调 `sessions.create({ cwd })`（原生 API）→ host `ensureSession` 自动 mkdir、建会话
4. host `session/created` 钩子把会话绑定到任务记录（兜底）
5. client 刷新会话列表 → `openWhenReady` 打开新会话

## 关键设计

- **无工作区**：`session.create` 传 `cwd` 而非 `workspaceId`，会话不 attach 任何工作区，显示在侧边栏「任务」（原 Ungrouped）分组。
- **任务组强制展开**：官方 `deriveGroups` 折叠时会把 sessions 切成空数组，必须同时改数据层（`expandedGroups.has(key) || workspaceId === void 0`）和渲染层。
- **空白会话常驻**：官方只显示「当前选中」的空白会话；任务目录（`D:\dsh_working\...`）下的空白会话通过 `isTaskSession` 常驻显示。
- **容错**：客户端偶发把成功的 `session.create` 误报失败（空错误信息），`createTask` 会轮询任务清单找回真实会话再打开。
