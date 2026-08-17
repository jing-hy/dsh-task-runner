# Changelog

## 1.0.1 — 2026-08-17

- **支持 DSH EAC 4.1.0** 桌面版（web-desktop profile / `dsh.profile.bundles` 加载机制）。
- **任务栏空态常驻**：没有任务会话时，侧边栏「任务」分组不再整体消失，
  标题下方显示「暂无任务」（宿主 `dsh-client-ui-workspace` 空分组不再被裁剪）。
- 新增幂等补丁脚本 `scripts/patch-sidebar-always-visible.mjs`：EAC 升级覆盖
  官方包后重跑即可恢复任务栏常驻行为（改宿主文件，强刷 Ctrl+Shift+R 生效，无需重启）。

## 0.1.0 — 2026-08-16

Initial release.

- Project/task dual-mode workspaces for DSH (including DSH EAC desktop).
- Tasks skip the workspace picker: each task conversation gets a fresh
  scratch directory (`D:\dsh_working\<name>-<timestamp>`) as its cwd via the
  native `session.create` cwd parameter (no workspace attachment).
- Sidebar: "工作区" header with a "项目" section (workspace folders) and a
  persistent "任务" section for all no-workspace sessions, with "暂无项目 /
  暂无任务" empty states.
- New-session flow stays official; the workspace picker gains a
  "无工作区（任务）" option.
- Host: durable task manifest, fenced `/task-runner/api/*` JSON API, `/task`
  command surface.
- Client: task panel (named tasks, list, cleanup) via `openPanel()`.
