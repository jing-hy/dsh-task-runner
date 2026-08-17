# dsh-task-runner

DSH（DeepSeek Harness，含 DSH EAC 桌面版）插件：把侧边栏升级为「项目 / 任务」双模式。

- **项目（Project）**：现有行为不变 —— 侧边栏「工作区」标题下新增「项目」分组，各工作区文件夹与会话照常显示。
- **任务（Task）**：与项目平级的独立分组 —— 不绑定任何工作区，每次新建任务自动在 `D:\dsh_working\<名称>-<时间戳>\` 下创建独立临时目录作为会话工作目录，像 Codex 一样即开即用；所有无工作区会话（含旧 Ungrouped）都显示在「任务」组下，空时显示「暂无任务」。

新建对话走**官方流程**：点「新建会话」→ 空状态 →「选择工作区」菜单里除了各工作区，还多了一项 **「无工作区（任务）」**，点击即在任务根目录下创建新会话并直接打开。

## 工作原理（为什么不需要 hack 核心）

DSH 的 `session.create` API 原生支持 `cwd` 参数（与 `workspaceId` 互斥）：
传 `cwd` 创建的会话**不 attach 任何工作区**，且 host 会自动 `mkdir` 该目录。
本插件只是把这个被 UI 隐藏的能力接出来：

- host 侧维护任务清单（`D:\dsh_working\.tasks.json`），提供 fenced JSON API 与 `/task` 命令；
- client 侧通过官方选择器/侧边栏的「任务」分组提供「无工作区」入口，用 `sessions.create({ cwd })` 创建无工作区会话；
- host 钩子兜底：任何 `cwd` 落在任务根目录下的会话都会自动登记/回收，即使绕过了 UI。

## 安装

```bash
# 本地开发路径安装
dsh plugin --profile web add link:D:\coding\dsh-task-runner

# 或从 GitHub / npm 安装
dsh plugin --profile web add dsh-task-runner
```

仓库：https://github.com/jing-hy/dsh-task-runner

装完**完全退出并重启 DSH**（EAC 桌面端：正常关闭后重新打开）才会生效。
验证：侧边栏底部出现「任务」按钮；profile 的 `package.json` 里 `dsh.profile.bundles` 已包含 `dsh-task-runner`。

## 使用

### 任务面板（推荐）

1. 点侧边栏底部的「▦ 任务」按钮打开任务面板；
2. 输入任务名称（可留空，留空自动命名 `task-<时间戳>`），点「新建」；
3. 新会话立即打开，工作目录为 `D:\dsh_working\<名称>-<时间戳>\`；
4. 面板里每个任务可「打开」（恢复其会话；会话已删除则在**原目录**新开）或「清理」（删除目录与登记）；
5. 「清理全部已结束任务」只清理 `finished` / `missing` 状态的任务；活跃任务需先结束其会话，面板不会误删。

### /task 命令（会话内管理）

```
/task list                 # 列出所有任务
/task new <名称>            # 创建任务目录并登记
/task open <名称|id>        # 查看任务信息（从面板打开会话）
/task clean [名称|id]       # 清理已结束任务（不带参数=清理全部）
```

## 配置

默认值开箱即用（Windows 任务根目录为 `D:\dsh_working`，其他平台为 `~/.dsh/tasks`）。
需要覆盖时，在 profile 的 `cordis.patch.yml` 里给插件行加 `config`：

```yaml
- insert:
    - id: task-runner
      name: 'dsh-task-runner'
      config:
        rootDir: 'E:\\dsh_tasks'   # 自定义任务根目录
        nameMaxLength: 60          # 名称长度上限（默认 40）
```

## 卸载

```bash
dsh plugin --profile web remove dsh-task-runner
```

移除后重启 DSH。任务目录与 `D:\dsh_working\.tasks.json` **不会**被删除（保留你的数据），可手动清理。

## 与已有 `dsh_working` 工作区的说明

若你的 `~/.dsh/storages/workspace.json` 里已手工注册过 `D:\dsh_working` 为工作区，建议删除该注册
（任务目录改为通过 `cwd` 直接创建，不经过工作区注册表；留着它也不会影响任务，只是侧边栏多一个
没有新会话的空工作区）。删除方式：设置 → 工作区，或直接编辑 `workspace.json` 并重启。

## 安全与边界

- `/task-runner/api/*` 采用与官方插件一致的浏览器信任围栏（loopback / trusted-host / 同源校验），
  仅接受 POST；
- 所有目录操作都限制在任务根目录内（`withinRoot` 校验），拒绝路径穿越；
  **任务根目录本身永远不会被当作任务**（`adopt` 与会话钩子均排除），即便出现指向根目录的脏注册记录，
  `cleanup` 也只会注销记录、绝不触碰根目录内容；
- 清理默认拒绝活跃任务（需 `force`）；任务目录被手动删除会标记为 `missing`，清理时只清注册不报错；
- 子代理会话（`origin: 'subagent'`）不会被登记为任务。

## 开发

```bash
npm test                          # registry 单测（node:test）
node test/host-smoke.mjs          # host 挂载 + API 全链路冒烟
node test/client-load-sim.mjs     # client 加载模拟（ModuleLoader + apply）
```

插件结构：

```
lib/index.js        host 插件：Config / API / 会话钩子 / /task 命令
lib/registry.js     TaskRegistry：任务清单与目录生命周期（纯 Node，可单测）
lib/wire.js         JSON API 工具（受限 body 读取、响应封装）
lib/trust-fence.js  浏览器信任围栏
lib/client.js       client 插件：任务面板 + createTask / openPanel / isTaskDir
test/               单测与冒烟
```

兼容性：**v1.0.1 起支持 DSH EAC 4.1.0 桌面版**（web-desktop profile，经 `dsh.profile.bundles` 加载）；向下兼容 `dsh 0.1.0-rc.6`（EAC 3.0.1）的 web profile 插件机制（`dsh.bundle.patch`）。

## 疑难排查

- **侧边栏任务区看不到会话**：任务组（无工作区分组）默认折叠，本插件已将其强制展开；强刷页面（Ctrl+Shift+R）后生效。
- **没有任务时侧边栏「任务」栏整个消失**：宿主只在存在无工作区会话时才渲染「任务」分组。v1.0.1 提供幂等补丁脚本 `scripts/patch-sidebar-always-visible.mjs`，让任务栏常驻并在空时显示「暂无任务」；改的是宿主 `dsh-client-ui-workspace`（强刷生效，无需重启），EAC 升级后重跑一次即可。
- **创建任务时报 "session create failed"**：客户端偶发把已成功的创建误报为失败（host 实际已建）。本插件已容错：从任务清单找回真实会话并打开；如仍复现，查看浏览器控制台 `[dsh-task-runner] createTask failed:` 日志。
- **右侧栏（better-sidebar）看不到新建文件**：better-sidebar 的 explorer 不自动刷新（设计如此），点其右上角刷新按钮即可。
- **任务根目录可改**：profile 的 `cordis.patch.yml` 里给插件行加 `config.rootDir`（默认 `D:\dsh_working`）。
- **升级 EAC 后官方补丁失效**：本插件 patch 了官方 `dsh-client-ui-workspace` 等包（`resources\app\node_modules` 内），EAC 升级会覆盖这些文件。重新应用：先 `node scripts/patch-sidebar-always-visible.mjs`（任务栏常驻补丁，幂等），其余按 `docs/patching.md` 说明操作（官方包改动前都有 `.bak-taskrunner-*` / `.bak-taskbar-*` 备份）。
