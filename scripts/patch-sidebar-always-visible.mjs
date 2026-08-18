#!/usr/bin/env node
/**
 * dsh-task-runner — sidebar "任务" group patch (replay script, v3).
 *
 * Upstream behavior: the official workspace sidebar renders the ungrouped
 * ("任务") bucket only while at least one loose/task session exists
 * (`groupByWorkspace`: `if (stray.length > 0)`). With zero task sessions the
 * whole group disappears from the UI.
 *
 * This patch: keeps the group permanently visible when the task-runner client
 * half is present, renders a "暂无任务" placeholder when empty, labels the
 * group "任务", wires its "+" row button to `window.__dshTaskRunner.createTask()`,
 * and (rc.7) adds a "项目" section title above the workspace groups.
 *
 * v3 applies each sub-patch idempotently (skips whatever is already present), so
 * re-running after an EAC upgrade or after a code change simply fills in the
 * missing pieces. Two host layouts are supported:
 *   - EAC 4.2 / dsh-client-ui-workspace 0.1.0-rc.7: group header is the
 *     `ProjectRowItem` component; the "+" row button already exists but its
 *     `onCreate` is a no-op for ungrouped groups. Patch 4 is skipped by design
 *     (rc.7 has no "项目" title row; patch 4a alone would delete the add button).
 *   - EAC 4.1 / earlier: legacy `dtr-section-title` header; full patch set incl.
 *     patch 4 applies.
 *
 * The patched module is served as `/plugins/@deepseek-ai/dsh-client-ui-workspace/client.js`,
 * so a hard refresh (Ctrl+Shift+R) applies it — no DSH restart.
 * Usage:
 *   node scripts/patch-sidebar-always-visible.mjs [path-to-EAC-resources-app]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const REL = path.join("node_modules", "@deepseek-ai", "dsh-client-ui-workspace", "lib", "client.js");
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// ── Patch 1 (all layouts): keep the ungrouped (task) group when task-runner is present ──
const OLD_GROUP = 'if (stray.length > 0) groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));';
const NEW_GROUP =
  '// dsh-task-runner patch: keep the task (ungrouped) section visible even with zero\n' +
  '\t\t\t// task sessions so the sidebar\'s "任务" group never disappears. Guarded on the\n' +
  '\t\t\t// task-runner client half; without it upstream behavior (hide empty) is kept.\n' +
  '\t\t\tif (stray.length > 0 || typeof window.__dshTaskRunner?.createTask === "function") groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));';

// ── Patch 2 (all layouts): empty placeholder row under the "任务" header ──
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

// ── Patch 3 (EAC 4.2 / ProjectRowItem layout) ──
// 3a: label the ungrouped bucket "任务".
const OLD_LABEL = '\t\t\tconst label = row.workspaceId === void 0 ? t("group.ungrouped") : row.label;';
const NEW_LABEL = '\t\t\tconst label = row.workspaceId === void 0 ? "任务" : row.label;';
// 3b: wire the always-present "+" row button of the ungrouped group to createTask.
const OLD_ONCREATE =
  '\t\t\t\t\t\t\t\t\t\tonCreate: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId !== void 0) {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(group.key, true);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tstartSession(group.workspaceId);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t},';
const NEW_ONCREATE =
  '\t\t\t\t\t\t\t\t\t\tonCreate: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t// dsh-task-runner: the "任务" row "+" starts a task session (no workspace)\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId === void 0) {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\twindow.__dshTaskRunner?.createTask?.();\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\treturn;\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId !== void 0) {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(group.key, true);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tstartSession(group.workspaceId);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t},';
// 3c: "项目" section title above the workspace groups (rc.7 groups.map head).
const OLD_MAP = '}), groups.map((group) => {';
const NEW_MAP =
  '}), groups.some((g) => g.workspaceId !== void 0) && typeof window.__dshTaskRunner?.createTask === "function" && (0, react_jsx_runtime.jsx)("div", { className: "dtr-section-title dtr-section-title-project dtr-project-title", style: { height: 36, display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 4, paddingRight: 4, fontSize: 12, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)", fontWeight: 600, flex: "none" }, children: "项目" }), groups.map((group) => {';
// 3d: hide the folder/chevron icons on the ungrouped (任务) row so it reads like the "项目" title.
const OLD_ICONS =
  '\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n' +
  '\t\t\t\t\t\tclassName: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder, active && Rows_module_css_default.folderActive),\n' +
  '\t\t\t\t\t\tchildren: row.expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})\n' +
  '\t\t\t\t\t}),\n' +
  '\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", {\n' +
  '\t\t\t\t\t\tclassName: clsx(Rows_module_css_default.slot, Rows_module_css_default.chevron),\n' +
  '\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: clsx(Rows_module_css_default.arrow, row.expanded && Rows_module_css_default.arrowOpen) })\n' +
  '\t\t\t\t\t}),';
const NEW_ICONS =
  '\t\t\t\t\trow.workspaceId !== void 0 && (0, react_jsx_runtime.jsx)("span", {\n' +
  '\t\t\t\t\t\tclassName: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder, active && Rows_module_css_default.folderActive),\n' +
  '\t\t\t\t\t\tchildren: row.expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})\n' +
  '\t\t\t\t\t}),\n' +
  '\t\t\t\t\trow.workspaceId !== void 0 && (0, react_jsx_runtime.jsx)("span", {\n' +
  '\t\t\t\t\t\tclassName: clsx(Rows_module_css_default.slot, Rows_module_css_default.chevron),\n' +
  '\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: clsx(Rows_module_css_default.arrow, row.expanded && Rows_module_css_default.arrowOpen) })\n' +
  '\t\t\t\t\t}),';

// 3e: render the ungrouped (任务) group as a plain section title (identical to 项目) — no hover/row chrome.
const OLD_PRI =
  '\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(ProjectRowItem, {\n' +
  '\t\t\t\t\t\t\t\t\t\tgroup,\n' +
  '\t\t\t\t\t\t\t\t\t\tt,\n' +
  '\t\t\t\t\t\t\t\t\t\tonToggle: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.expanded) setExpandedSessionGroups((keys) => keys.filter((key) => key !== group.key));\n' +
  '\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(group.key, !group.expanded);\n' +
  '\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\tonCreate: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t// dsh-task-runner: the "任务" row "+" starts a task session (no workspace)\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId === void 0) {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\twindow.__dshTaskRunner?.createTask?.();\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\treturn;\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId !== void 0) {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(group.key, true);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tstartSession(group.workspaceId);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\tdrag: workspaceDragProps,\n' +
  '\t\t\t\t\t\t\t\t\t\tactions: group.workspaceId === void 0 ? void 0 : {\n' +
  '\t\t\t\t\t\t\t\t\t\t\trename: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t/* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId !== void 0) onRenameRequest(group.workspaceId, group.label);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\t\tdelete: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t/* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId !== void 0) onDeleteRequest(group.workspaceId, group.label);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t}),';
const NEW_PRI =
  'group.workspaceId === void 0\n' +
  '\t\t\t\t\t\t\t\t\t? (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\t\t\t\tclassName: "dtr-section-title dtr-task-title",\n' +
  '\t\t\t\t\t\t\t\t\t\tstyle: { height: 36, display: "flex", alignItems: "center", justifyContent: "space-between", paddingLeft: 4, paddingRight: 4, fontSize: 12, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)", fontWeight: 600, flex: "none", cursor: "pointer", userSelect: "none" },\n' +
  '\t\t\t\t\t\t\t\t\t\tonClick: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.expanded) setExpandedSessionGroups((keys) => keys.filter((key) => key !== group.key));\n' +
  '\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(group.key, !group.expanded);\n' +
  '\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\tchildren: [\n' +
  '\t\t\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { children: "任务" }),\n' +
  '\t\t\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("button", {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\ttype: "button",\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.iconButton,\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t"aria-label": "新建任务",\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\ttitle: "新建任务",\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tonClick: (e) => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t\te.stopPropagation();\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t\twindow.__dshTaskRunner?.createTask?.();\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})\n' +
  '\t\t\t\t\t\t\t\t\t\t\t})\n' +
  '\t\t\t\t\t\t\t\t\t\t]\n' +
  '\t\t\t\t\t\t\t\t\t})\n' +
  '\t\t\t\t\t\t\t\t\t: (0, react_jsx_runtime.jsx)(ProjectRowItem, {\n' +
  '\t\t\t\t\t\t\t\t\t\tgroup,\n' +
  '\t\t\t\t\t\t\t\t\t\tt,\n' +
  '\t\t\t\t\t\t\t\t\t\tonToggle: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.expanded) setExpandedSessionGroups((keys) => keys.filter((key) => key !== group.key));\n' +
  '\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(group.key, !group.expanded);\n' +
  '\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\tonCreate: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t// dsh-task-runner: the "任务" row "+" starts a task session (no workspace)\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId === void 0) {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\twindow.__dshTaskRunner?.createTask?.();\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\treturn;\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId !== void 0) {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tsetGroupExpanded(group.key, true);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tstartSession(group.workspaceId);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\tdrag: workspaceDragProps,\n' +
  '\t\t\t\t\t\t\t\t\t\tactions: group.workspaceId === void 0 ? void 0 : {\n' +
  '\t\t\t\t\t\t\t\t\t\t\trename: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t/* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId !== void 0) onRenameRequest(group.workspaceId, group.label);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t},\n' +
  '\t\t\t\t\t\t\t\t\t\t\tdelete: () => {\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\t/* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */\n' +
  '\t\t\t\t\t\t\t\t\t\t\t\tif (group.workspaceId !== void 0) onDeleteRequest(group.workspaceId, group.label);\n' +
  '\t\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t\t}\n' +
  '\t\t\t\t\t\t\t\t\t}),';

// ── Patch 3 (EAC 4.1 legacy): "新建任务" plus button on the task header row ──
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

// ── Patch 4 (EAC 4.1 legacy): move the "添加工作区" button from the 工作区 header row to the 项目 title row ──
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
const OLD_ST_SIG = 'function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {';
const NEW_ST_SIG = 'function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t, wsPlusRef, onToggleWsPicker }) {';
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
const OLD_SEARCH_SLOT =
  '\t\t\t\t\t\t\twide && (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.searchSlot, searchExpanded && WorkspaceBrowser_module_css_default.searchSlotExpanded),';
const NEW_SEARCH_SLOT =
  '\t\t\t\t\t\t\twide && (0, react_jsx_runtime.jsx)("div", {\n' +
  '\t\t\t\t\t\t\t\tclassName: clsx(WorkspaceBrowser_module_css_default.searchSlot, searchExpanded && WorkspaceBrowser_module_css_default.searchSlotExpanded),\n' +
  '\t\t\t\t\t\t\t\tstyle: searchExpanded ? void 0 : { marginLeft: "auto" },';

/** Idempotent apply: skip if already present, else require the anchor. */
function applyPatch(next, label, oldText, newText) {
  if (newText && next.includes(newText)) {
    console.log(`  [skip] ${label}: already applied`);
    return next;
  }
  if (next.includes(oldText)) {
    console.log(`  [apply] ${label}`);
    return next.replace(oldText, newText);
  }
  console.error(`[patch-sidebar-always-visible] ${label}: anchor not found — host version changed?`);
  process.exit(1);
}

function findTarget(argv) {
  const given = argv[2];
  if (given) return path.join(given, REL);
  const env = process.env.DSH_EAC_RESOURCES;
  if (env) return path.join(env, REL);
  const base = process.env.LOCALAPPDATA || "C:\\Users\\Administrator\\AppData\\Local";
  for (const c of [
    path.join(base, "Programs", "Deepseek Harness EAC", "resources", "app"),
    path.join(base, "Programs", "Deepseek Harness EAC", "resources", "app.asar.unpacked")
  ]) {
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
let next = readFileSync(target, "utf8");
const isProjectRowLayout = next.includes("function ProjectRowItem(");

if (isProjectRowLayout) {
  console.log("[patch-sidebar-always-visible] EAC 4.2 ProjectRowItem layout — applying rc.7 patch set.");
  next = applyPatch(next, "patch 1 (group always visible)", OLD_GROUP, NEW_GROUP);
  next = applyPatch(next, "patch 2 (empty placeholder)", OLD_EMPTY, NEW_EMPTY);
  next = applyPatch(next, "patch 3a (label 任务)", OLD_LABEL, NEW_LABEL);
  next = applyPatch(next, "patch 3b (onCreate wiring)", OLD_ONCREATE, NEW_ONCREATE);
  next = applyPatch(next, "patch 3c (项目 title)", OLD_MAP, NEW_MAP);
  next = applyPatch(next, "patch 3d (任务 row icons)", OLD_ICONS, NEW_ICONS);
  next = applyPatch(next, "patch 3e (任务 title row)", OLD_PRI, NEW_PRI);
} else {
  console.log("[patch-sidebar-always-visible] EAC 4.1 legacy layout — applying full patch set incl. patch 4.");
  next = applyPatch(next, "patch 1 (group always visible)", OLD_GROUP, NEW_GROUP);
  next = applyPatch(next, "patch 2 (empty placeholder)", OLD_EMPTY, NEW_EMPTY);
  next = applyPatch(next, "patch 3 (task header row)", OLD_TITLE, NEW_TITLE);
  next = applyPatch(next, "patch 4a (headerActions)", OLD_HEADER_ACTIONS, NEW_HEADER_ACTIONS);
  next = applyPatch(next, "patch 4b (SessionTree call)", OLD_ST_CALL, NEW_ST_CALL);
  next = applyPatch(next, "patch 4c (SessionTree signature)", OLD_ST_SIG, NEW_ST_SIG);
  next = applyPatch(next, "patch 4d (project title button)", OLD_PROJECT_TITLE, NEW_PROJECT_TITLE);
  next = applyPatch(next, "patch 4e (search slot margin)", OLD_SEARCH_SLOT, NEW_SEARCH_SLOT);
}

const bak = `${target}.bak-taskbar-${stamp()}`;
copyFileSync(target, bak);
writeFileSync(target, next, "utf8");
console.log(`[patch-sidebar-always-visible] done. backup: ${bak}`);
console.log("  effect : hard-refresh the DSH web UI (Ctrl+Shift+R).");
