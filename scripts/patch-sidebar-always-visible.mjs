#!/usr/bin/env node
/**
 * dsh-task-runner — sidebar "任务" group always-visible patch (replay script).
 *
 * Upstream behavior: the official workspace sidebar renders the "任务" group
 * (the renamed Ungrouped bucket, activated when the task-runner client half
 * exposes `window.__dshTaskRunner.createTask`) only while at least one
 * ungrouped/task session exists (`groupByWorkspace`: `if (stray.length > 0)`).
 * With zero task sessions the whole group — including the "任务" header —
 * disappears from the UI.
 *
 * This patch keeps the group permanently visible whenever the task-runner
 * client half is present, and renders a "暂无任务" placeholder row below the
 * header when the group is empty. It applies two minimal edits to the host
 * module:
 *
 *   EAC resources\app\node_modules\@deepseek-ai\dsh-client-ui-workspace\lib\client.js
 *
 * That file is served dynamically as `/plugins/@deepseek-ai/dsh-client-ui-workspace/client.js`,
 * so a hard refresh (Ctrl+Shift+R) is enough for the change to take effect —
 * no DSH restart needed. EAC upgrades overwrite the file; re-run this script
 * afterwards (it is idempotent and backs up before patching).
 *
 * Usage:
 *   node scripts/patch-sidebar-always-visible.mjs [path-to-EAC-resources-app]
 *   DSH_EAC_RESOURCES="C:\...\resources\app" node scripts/patch-sidebar-always-visible.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const MARK = "dsh-task-runner patch: keep the task (ungrouped) section visible";
const REL = path.join("node_modules", "@deepseek-ai", "dsh-client-ui-workspace", "lib", "client.js");
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// ── Patch 1: keep the ungrouped (task) group when task-runner is present ──
const OLD_GROUP = 'if (stray.length > 0) groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));';
const NEW_GROUP =
  '// dsh-task-runner patch: keep the task (ungrouped) section visible even with zero\n' +
  '\t\t\t// task sessions so the sidebar\'s "任务" group never disappears. Guarded on the\n' +
  '\t\t\t// task-runner client half; without it upstream behavior (hide empty) is kept.\n' +
  '\t\t\tif (stray.length > 0 || typeof window.__dshTaskRunner?.createTask === "function") groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));';

// ── Patch 2: empty placeholder row under the "任务" header ──
const OLD_EMPTY =
  '\t\t\t\t\t\t\t\t\t}),\n' +
  '\t\t\t\t\t\t\t\t\t(expandedSessionGroups.includes(group.key) ? group.sessions : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {';
const NEW_EMPTY =
  '\t\t\t\t\t\t\t\t\t}),\n' +
  '\t\t\t\t\t\t\t\t\tgroup.workspaceId === void 0 && group.sessions.length === 0 && (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\t\t\t\tclassName: "dtr-section-empty",\n' +
  '\t\t\t\t\t\t\t\t\t\tstyle: { padding: "2px 12px 10px", fontSize: 12, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)", opacity: 0.85 },\n' +
  '\t\t\t\t\t\t\t\t\t\tchildren: "暂无任务"\n' +
  '\t\t\t\t\t\t\t\t\t}),\n' +
  '\t\t\t\t\t\t\t\t\t(expandedSessionGroups.includes(group.key) ? group.sessions : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {';

function findTarget(argv) {
  const given = argv[2];
  if (given) return path.join(given, REL);
  const env = process.env.DSH_EAC_RESOURCES;
  if (env) return path.join(env, REL);
  // Typical EAC install locations (win32).
  const base = process.env.LOCALAPPDATA || "C:\\Users\\Administrator\\AppData\\Local";
  const candidates = [
    path.join(base, "Programs", "Deepseek Harness EAC", "resources", "app"),
    path.join(base, "Programs", "Deepseek Harness EAC", "resources", "app.asar.unpacked")
  ];
  for (const c of candidates) {
    const p = path.join(c, REL);
    if (existsSync(p)) return p;
  }
  return null;
}

const target = findTarget(process.argv);
if (target === null) {
  console.error("[patch-sidebar-always-visible] target not found. Pass the EAC resources/app path as argv[2] or set DSH_EAC_RESOURCES.");
  process.exit(1);
}
const source = readFileSync(target, "utf8");
if (source.includes(MARK)) {
  console.log(`[patch-sidebar-always-visible] already patched (${target}) — nothing to do.`);
  process.exit(0);
}
let next = source;
let applied = 0;
if (next.includes(OLD_GROUP)) {
  next = next.replace(OLD_GROUP, NEW_GROUP);
  applied += 1;
} else {
  console.error("[patch-sidebar-always-visible] patch 1 anchor (groupByWorkspace) not found — host version changed?");
  process.exit(1);
}
if (next.includes(OLD_EMPTY)) {
  next = next.replace(OLD_EMPTY, NEW_EMPTY);
  applied += 1;
} else {
  console.error("[patch-sidebar-always-visible] patch 2 anchor (empty placeholder) not found — host version changed?");
  process.exit(1);
}
const bak = `${target}.bak-taskbar-${stamp()}`;
copyFileSync(target, bak);
writeFileSync(target, next, "utf8");
console.log(`[patch-sidebar-always-visible] applied ${applied}/2 patches.`);
console.log(`  target : ${target}`);
console.log(`  backup : ${bak}`);
console.log("  effect : hard-refresh the DSH web UI (Ctrl+Shift+R) — the module is served with a cache-busting rev.");
