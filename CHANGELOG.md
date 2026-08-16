# Changelog

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
