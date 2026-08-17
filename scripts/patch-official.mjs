#!/usr/bin/env node
/**
 * dsh-task-runner — 官方包补丁自动注入脚本
 *
 * 背景：task-runner 的侧边栏「项目/任务」分组、工作区菜单「无工作区（任务）」入口
 * 是通过修改 EAC 官方包 @deepseek-ai/dsh-client-ui-workspace 的 lib/client.js 实现的。
 * EAC 升级会重置官方包，导致补丁丢失（task-runner UI 失效，host 端不受影响）。
 *
 * 本脚本：检测补丁状态 → 未打则备份 + 自动应用 → 已打则跳过（幂等）。
 * 用法：node scripts/patch-official.mjs
 * 建议：EAC 升级后重跑一次（也可在 task-runner 的 postinstall 里调用）。
 *
 * 补丁清单（rc.6 / EAC 4.1.0，2026-08-17 验证）：
 *   1. deriveGroups 未分组强制展开（任务会话可见）
 *   2. WorkspacePickFlow 菜单加「无工作区（任务）」项（创建任务入口）
 *   3. handleSelect 处理 task-null-entry
 *   4. 未分组 label → 「任务」（task-runner 存在时）
 *   5. 未分组组的 ProjectRowItem → 「任务」标题行（与「项目」平级并列）
 *   6. 分组列表顶部加「项目」标题行（workspace 组存在时）
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WIN32_APP = "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Deepseek Harness EAC\\resources\\app\\node_modules\\@deepseek-ai";
const TARGET = path.join(WIN32_APP, "dsh-client-ui-workspace", "lib", "client.js");

/** 每个补丁：old（原始）→ new（补丁后）。检测 new 是否已存在判断是否已打。 */
const PATCHES = [
  // 1. deriveGroups：未分组（workspaceId === void 0）强制展开
  {
    old: "for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {\n\t\t\t\tconst expanded = expandedGroups.has(g.key);",
    next: "for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {\n\t\t\t\tconst expanded = expandedGroups.has(g.key) || g.workspaceId === void 0;",
    probe: "expandedGroups.has(g.key) || g.workspaceId === void 0"
  },
  // 2. WorkspacePickFlow：items 加「无工作区（任务）」项
  {
    old: "const items = pinAdd ? workspaces.map((workspace) => ({\n\t\t\t\tid: workspace.workspaceId,\n\t\t\t\tlabel: workspace.title,\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, { size: 16 }),\n\t\t\t\tdisabled: flowBusy\n\t\t\t})) : addEntries;",
    next: "const taskEntry = typeof window.__dshTaskRunner?.createTask === \"function\" ? [{\n\t\t\t\tid: \"task-null-entry\",\n\t\t\t\tlabel: \"无工作区（任务）\",\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 16 }),\n\t\t\t\tdisabled: flowBusy\n\t\t\t}] : [];\n\t\t\tconst items = [...(pinAdd ? workspaces.map((workspace) => ({\n\t\t\t\tid: workspace.workspaceId,\n\t\t\t\tlabel: workspace.title,\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, { size: 16 }),\n\t\t\t\tdisabled: flowBusy\n\t\t\t})) : addEntries), ...taskEntry];",
    probe: "task-null-entry"
  },
  // 3. handleSelect：task-null-entry 分支
  {
    old: "const handleSelect = (id) => {\n\t\t\t\tif (id === ADD_WORKSPACE) {\n\t\t\t\t\topenDirectoryFlow();\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tonPick(id);\n\t\t\t};",
    next: "const handleSelect = (id) => {\n\t\t\t\tif (id === ADD_WORKSPACE) {\n\t\t\t\t\topenDirectoryFlow();\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tif (id === \"task-null-entry\") {\n\t\t\t\t\twindow.__dshTaskRunner?.createTask?.();\n\t\t\t\t\tonClose();\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tonPick(id);\n\t\t\t};",
    probe: "task-null-entry\") {"
  },
  // 4. 未分组 label → 「任务」
  {
    old: "const label = row.workspaceId === void 0 ? t(\"group.ungrouped\") : row.label;",
    next: "const label = row.workspaceId === void 0\n\t\t\t\t? (typeof window.__dshTaskRunner?.createTask === \"function\" ? \"任务\" : t(\"group.ungrouped\"))\n\t\t\t\t: row.label;",
    probe: "? (typeof window.__dshTaskRunner?.createTask === \"function\" ? \"任务\""
  },
  // 5. 未分组组 ProjectRowItem → 「任务」标题行（与「项目」平级）
  {
    old: "children: [\n\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)(ProjectRowItem, {",
    next: "children: [\n\t\t\t\t\t\t\t\t\tgroup.workspaceId === void 0\n\t\t\t\t\t\t\t\t\t\t? (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dtr-section-title\",\n\t\t\t\t\t\t\t\t\t\t\tstyle: { height: 36, display: \"flex\", alignItems: \"center\", paddingLeft: 4, fontSize: 12, lineHeight: \"20px\", color: \"var(--dsw-alias-label-tertiary)\", fontWeight: 600, flex: \"none\" },\n\t\t\t\t\t\t\t\t\t\t\tchildren: \"任务\"\n\t\t\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t\t\t\t: (0, react_jsx_runtime.jsx)(ProjectRowItem, {",
    probe: "children: [\n\t\t\t\t\t\t\t\t\tgroup.workspaceId === void 0"
  },
  // 6. 分组列表顶部「项目」标题行
  {
    old: "children: [groups.length === 0 && (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.empty,\n\t\t\t\t\t\t\tchildren: t(\"empty.none\")\n\t\t\t\t\t\t}), groups.map((group) => {",
    next: "children: [groups.length === 0 && (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\tclassName: WorkspaceBrowser_module_css_default.empty,\n\t\t\t\t\t\t\tchildren: t(\"empty.none\")\n\t\t\t\t\t\t}), groups.some((g) => g.workspaceId !== void 0) && typeof window.__dshTaskRunner?.createTask === \"function\" && (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dtr-section-title\",\n\t\t\t\t\t\t\tstyle: { height: 36, display: \"flex\", alignItems: \"center\", paddingLeft: 4, fontSize: 12, lineHeight: \"20px\", color: \"var(--dsw-alias-label-tertiary)\", fontWeight: 600, flex: \"none\" },\n\t\t\t\t\t\t\tchildren: \"项目\"\n\t\t\t\t\t\t}), groups.map((group) => {",
    probe: "children: \"项目\""
  }
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function log(msg) {
  console.log(`[patch-official] ${msg}`);
}

function main() {
  if (!existsSync(TARGET)) {
    console.error(`[patch-official] 未找到官方包: ${TARGET}\n请检查 EAC 安装路径。`);
    process.exit(1);
  }
  let src = readFileSync(TARGET, "utf8");

  // 检测是否已补丁（任一 probe 命中即认为已打）
  const applied = PATCHES.filter((p) => src.includes(p.probe));
  const missing = PATCHES.filter((p) => !src.includes(p.probe));

  if (missing.length === 0) {
    log(`已是最新（${applied.length} 处补丁全部就位），跳过。文件: ${TARGET}`);
    process.exit(0);
  }

  // 备份
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const bak = `${TARGET}.bak-taskrunner-${stamp}`;
  copyFileSync(TARGET, bak);
  log(`已备份 → ${bak}`);

  // 逐个应用缺失的补丁
  let failed = 0;
  for (const p of missing) {
    if (!src.includes(p.old)) {
      console.error(`[patch-official] ✗ 找不到补丁锚点（官方包结构可能已变）: ${p.probe.slice(0, 40)}…`);
      failed += 1;
      continue;
    }
    src = src.replace(p.old, p.next);
    log(`✓ 应用: ${p.probe.slice(0, 40)}…`);
  }

  if (failed > 0) {
    console.error(`[patch-official] ${failed} 处补丁失败（锚点不匹配，官方 rc 结构变化需更新本脚本）。`);
    process.exit(2);
  }

  writeFileSync(TARGET, src, "utf8");
  log(`完成：${missing.length} 处补丁已应用（共 ${PATCHES.length} 处）。强刷页面 Ctrl+Shift+R 生效。`);
}

main();
