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

// ── Patch 3: "新建任务" plus button on the task header row ──
const OLD_TITLE =
  '\t\t\t\t\t\t\t\t\tgroup.workspaceId === void 0\n' +
  '\t\t\t\t\t\t\t\t\t\t? (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\t\t\t\t\tclassName: "dtr-section-title",\n' +
  '\t\t\t\t\t\t\t\t\t\t\tstyle: { height: 36, display: "flex", alignItems: "center", paddingLeft: 4, fontSize: 12, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)", fontWeight: 600, flex: "none" },\n' +
  '\t\t\t\t\t\t\t\t\t\t\tchildren: "任务"\n' +
  '\t\t\t\t\t\t\t\t\t\t})';
const NEW_TITLE =
  '\t\t\t\t\t\t\t\t\tgroup.workspaceId === void 0\n' +
  '\t\t\t\t\t\t\t\t\t\t? (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\t\t\t\t\tclassName: "dtr-section-title",\n' +
  '\t\t\t\t\t\t\t\t\t\t\tstyle: { height: 36, display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 4, paddingRight: 4, fontSize: 12, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)", fontWeight: 600, flex: "none" },\n' +
  '\t\t\t\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tchildren: "任务"\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("button", {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\ttype: "button",\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.iconButton,\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t"aria-label": "新建任务",\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\ttitle: "新建任务",\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tonClick: (e) => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t\te.stopPropagation();\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t\twindow.__dshTaskRunner?.createTask?.();\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})\n' +
  '\t\t\t\t\t\t\t\t\t\t\t})]\n' +
  '\t\t\t\t\t\t\t\t\t\t})';

// ── Patch 4: move the "添加工作区" button from the 工作区 header row to the 项目 title row ──
// 4a: headerActions keeps only the view-options menu
const OLD_HEADER_ACTIONS =
  '\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {\n' +
  '\t\t\t\t\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.headerActions, wide && searchExpanded && WorkspaceBrowser_module_css_default.headerActionsHidden),\n' +
  '\t\t\t\t\t\t\t\tchildren: [wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {\n' +
  '\t\t\t\t\t\t\t\t\tgroupBy,\n' +
  '\t\t\t\t\t\t\t\t\torderBy,\n' +
  '\t\t\t\t\t\t\t\t\tonGroupPick: (mode) => {\n' +
  '\t\t\t\t\t\t\t\t\t\tactions.setGroupBy(mode);\n' +
  '\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\tonOrderPick: (mode) => {\n' +
  '\t\t\t\t\t\t\t\t\t\tactions.setOrderBy(mode);\n' +
  '\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\tt\n' +
  '\t\t\t\t\t\t\t\t}), directoryFlowAvailable && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {\n' +
  '\t\t\t\t\t\t\t\t\tlabel: t("workspace.add"),\n' +
  '\t\t\t\t\t\t\t\t\tside: "bottom",\n' +
  '\t\t\t\t\t\t\t\t\tdelayMs: 500,\n' +
  '\t\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("button", {\n' +
  '\t\t\t\t\t\t\t\t\t\tref: wsPlusRef,\n' +
  '\t\t\t\t\t\t\t\t\t\ttype: "button",\n' +
  '\t\t\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.iconButton,\n' +
  '\t\t\t\t\t\t\t\t\t\t"aria-label": t("workspace.add"),\n' +
  '\t\t\t\t\t\t\t\t\t\tonClick: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\tsetWsPickerOpen((v) => !v);\n' +
  '\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutline16, { size: wide ? 16 : 18 })\n' +
  '\t\t\t\t\t\t\t\t\t})\n' +
  '\t\t\t\t\t\t\t\t})]\n' +
  '\t\t\t\t\t\t\t}),';
const NEW_HEADER_ACTIONS =
  '\t\t\t\t\t\t\t(0, react_jsx_runtime.jsxs)("div", {\n' +
  '\t\t\t\t\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.headerActions, wide && searchExpanded && WorkspaceBrowser_module_css_default.headerActionsHidden),\n' +
  '\t\t\t\t\t\t\t\tchildren: [wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {\n' +
  '\t\t\t\t\t\t\t\t\tgroupBy,\n' +
  '\t\t\t\t\t\t\t\t\torderBy,\n' +
  '\t\t\t\t\t\t\t\t\tonGroupPick: (mode) => {\n' +
  '\t\t\t\t\t\t\t\t\t\tactions.setGroupBy(mode);\n' +
  '\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\tonOrderPick: (mode) => {\n' +
  '\t\t\t\t\t\t\t\t\t\tactions.setOrderBy(mode);\n' +
  '\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\tt\n' +
  '\t\t\t\t\t\t\t\t})]\n' +
  '\t\t\t\t\t\t\t}),';
// 4b: SessionTree call site gains wsPlusRef / onToggleWsPicker
const OLD_ST_CALL =
  '\t\t\t\t\t\t\torderBy,\n' +
  '\t\t\t\t\t\t\tt,\n' +
  '\t\t\t\t\t\t\tonRenameRequest: (workspaceId, currentTitle) => {';
const NEW_ST_CALL =
  '\t\t\t\t\t\t\torderBy,\n' +
  '\t\t\t\t\t\t\tt,\n' +
  '\t\t\t\t\t\t\twsPlusRef,\n' +
  '\t\t\t\t\t\t\tonToggleWsPicker: () => {\n' +
  '\t\t\t\t\t\t\t\tsetWsPickerOpen((v) => !v);\n' +
  '\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\tonRenameRequest: (workspaceId, currentTitle) => {';
// 4c: SessionTree signature
const OLD_ST_SIG = 'function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {';
const NEW_ST_SIG = 'function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t, wsPlusRef, onToggleWsPicker }) {';
// 4d: 项目 title row gains the add-workspace button (right-aligned)
const OLD_PROJECT_TITLE =
  '\t\t\t\t\t\t}), groups.some((g) => g.workspaceId !== void 0) && typeof window.__dshTaskRunner?.createTask === "function" && (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\tclassName: "dtr-section-title",\n' +
  '\t\t\t\t\t\t\tstyle: { height: 36, display: "flex", alignItems: "center", paddingLeft: 4, fontSize: 12, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)", fontWeight: 600, flex: "none" },\n' +
  '\t\t\t\t\t\t\tchildren: "项目"\n' +
  '\t\t\t\t\t\t}), groups.map((group) => {';
const NEW_PROJECT_TITLE =
  '\t\t\t\t\t\t}), groups.some((g) => g.workspaceId !== void 0) && typeof window.__dshTaskRunner?.createTask === "function" && (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\tclassName: "dtr-section-title",\n' +
  '\t\t\t\t\t\t\tstyle: { height: 36, display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 4, paddingRight: 4, fontSize: 12, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)", fontWeight: 600, flex: "none" },\n' +
  '\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", {\n' +
  '\t\t\t\t\t\t\t\tchildren: "项目"\n' +
  '\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {\n' +
  '\t\t\t\t\t\t\t\tlabel: t("workspace.add"),\n' +
  '\t\t\t\t\t\t\t\tside: "bottom",\n' +
  '\t\t\t\t\t\t\t\tdelayMs: 500,\n' +
  '\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("button", {\n' +
  '\t\t\t\t\t\t\t\t\tref: wsPlusRef,\n' +
  '\t\t\t\t\t\t\t\t\ttype: "button",\n' +
  '\t\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.iconButton,\n' +
  '\t\t\t\t\t\t\t\t\t"aria-label": t("workspace.add"),\n' +
  '\t\t\t\t\t\t\t\t\tonClick: (e) => {\n' +
  '\t\t\t\t\t\t\t\t\t\te.stopPropagation();\n' +
  '\t\t\t\t\t\t\t\t\t\tonToggleWsPicker();\n' +
  '\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutline16, { size: 16 })\n' +
  '\t\t\t\t\t\t\t\t})\n' +
  '\t\t\t\t\t\t\t})]\n' +
  '\t\t\t\t\t\t}), groups.map((group) => {';
// 4e: 工作区 header row — search slot pushed right (remaining buttons right-aligned)
const OLD_SEARCH_SLOT =
  '\t\t\t\t\t\t\twide && (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.searchSlot, searchExpanded && WorkspaceBrowser_module_css_default.searchSlotExpanded),';
const NEW_SEARCH_SLOT =
  '\t\t\t\t\t\t\twide && (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.searchSlot, searchExpanded && WorkspaceBrowser_module_css_default.searchSlotExpanded),\n' +
  '\t\t\t\t\t\t\t\tstyle: searchExpanded ? void 0 : { marginLeft: "auto" },';

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
if (next.includes(OLD_TITLE)) {
  next = next.replace(OLD_TITLE, NEW_TITLE);
  applied += 1;
} else {
  console.error("[patch-sidebar-always-visible] patch 3 anchor (task header row) not found — host version changed?");
  process.exit(1);
}
const patch4 = [
  ["4a headerActions", OLD_HEADER_ACTIONS, NEW_HEADER_ACTIONS],
  ["4b SessionTree call", OLD_ST_CALL, NEW_ST_CALL],
  ["4c SessionTree signature", OLD_ST_SIG, NEW_ST_SIG],
  ["4d project title button", OLD_PROJECT_TITLE, NEW_PROJECT_TITLE],
  ["4e search slot margin", OLD_SEARCH_SLOT, NEW_SEARCH_SLOT]
];
for (const [label, oldText, newText] of patch4) {
  if (next.includes(oldText)) {
    next = next.replace(oldText, newText);
    applied += 1;
  } else {
    console.error(`[patch-sidebar-always-visible] patch 4 (${label}) anchor not found — host version changed?`);
    process.exit(1);
  }
}
const bak = `${target}.bak-taskbar-${stamp()}`;
copyFileSync(target, bak);
writeFileSync(target, next, "utf8");
console.log(`[patch-sidebar-always-visible] applied ${applied}/8 patch edits.`);
console.log(`  target : ${target}`);
console.log(`  backup : ${bak}`);
console.log("  effect : hard-refresh the DSH web UI (Ctrl+Shift+R) — the module is served with a cache-busting rev.");
