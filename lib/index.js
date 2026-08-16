// @ts-check
/**
 * dsh-task-runner — host half.
 *
 * Gives a DSH profile Codex-style "task" conversations alongside the normal
 * workspace-bound "project" flow:
 *
 * - A task skips the workspace picker: its session is created with a fresh
 *   scratch directory under the task root (default `D:\dsh_working`) as the
 *   session `cwd`, so it never attaches to a workspace and shows up under
 *   the sidebar's Ungrouped section.
 * - The host keeps a durable task manifest (`<root>/.tasks.json`), exposes a
 *   fenced JSON API (`/task-runner/api/*`) that the browser half drives
 *   (allocate / list / attach / rename / cleanup), tracks session lifecycle
 *   (auto-register any session whose cwd lands inside the root, mark
 *   finished on disposal), and offers a `/task` command surface.
 *
 * @module dsh-task-runner
 */
import path from "node:path";
import os from "node:os";
import z from "@deepseek-ai/schemastery";
import { TaskRegistry, TaskNotFoundError, withinRoot } from "./registry.js";
import { isTrustedApiRequest } from "./trust-fence.js";
import {
  ApiError,
  optionalBoolean,
  optionalString,
  readJsonBody,
  requireString,
  writeError,
  writeJson,
  writeOk
} from "./wire.js";

/** Stable cordis plugin name. */
export const name = "task-runner";
/** Services required before the host half can mount. */
export const inject = ["commands", "webServer", "webRuntime", "sessions"];

/** Platform default for the task root (evaluated at module load). */
const DEFAULT_ROOT = process.platform === "win32"
  ? "D:\\dsh_working"
  : path.join(os.homedir(), ".dsh", "tasks");

/** Plugin configuration. */
export const Config = z.object({
  /** Root directory holding every task scratch directory. */
  rootDir: z.string().default(DEFAULT_ROOT),
  /** Cap on the task-name segment (directory names also carry a timestamp). */
  nameMaxLength: z.number().default(40)
});

/** Resolve the working directory of a session (header cwd), if any. */
function sessionCwd(session) {
  return typeof session?.header?.cwd === "string" ? session.header.cwd : void 0;
}

/** Whether a cwd is a task directory: strictly inside the root (not the root itself). */
function isTaskCwd(root, cwd) {
  const resolved = path.resolve(cwd);
  return resolved !== path.resolve(root) && withinRoot(root, resolved);
}

/** Whether a session is a durable top-level conversation (not a subagent). */
function isTopLevelSession(session) {
  return session?.header?.origin !== "subagent";
}

/**
 * Register (or attach) a task for a session whose cwd lies inside the root.
 * Best-effort: registry failures never break session events.
 */
function trackSession(ctx, registry, session) {
  const cwd = sessionCwd(session);
  if (cwd === void 0 || !isTopLevelSession(session)) return;
  if (!isTaskCwd(registry.rootDir, cwd)) return;
  void registry
    .adopt(cwd, String(session.id))
    .catch((error) => ctx.logger?.warn?.(`task-runner: tracking session failed: ${String(error)}`));
}

/**
 * Mount the plugin: registry service, lifecycle hooks, fenced API, commands.
 * @param {import("@deepseek-ai/cordis").Context} ctx - host plugin context.
 * @param {{rootDir: string, nameMaxLength: number}} config - validated config.
 */
export function apply(ctx, config) {
  const registry = new TaskRegistry({
    rootDir: config.rootDir,
    nameMaxLength: config.nameMaxLength
  });
  ctx.provide("taskRegistry", registry);
  // First use initializes (idempotent); failures surface to callers.
  const ensureReady = () => registry.init();

  // ── Session lifecycle ────────────────────────────────────────────────────
  // A session created with a cwd inside the root is a task conversation:
  // adopt the directory (creates the record when the browser half skipped
  // the host API, e.g. a direct session.create or a reset manifest).
  ctx.on("session/created", (session) => {
    trackSession(ctx, registry, session);
  });
  // Session gone -> release the task (keep its directory; status finished).
  ctx.on("session/disposed", (session) => {
    const cwd = sessionCwd(session);
    if (cwd === void 0 || !isTopLevelSession(session)) return;
    if (!isTaskCwd(registry.rootDir, cwd)) return;
    void (async () => {
      await ensureReady();
      const task = await registry.resolveByDir(cwd);
      if (task !== void 0) await registry.detach(task.id);
    })().catch((error) => ctx.logger?.warn?.(`task-runner: detaching session failed: ${String(error)}`));
  });
  // Agent activity -> touch the task's lastActiveAt.
  ctx.on("agent/status", ({ agent, status }) => {
    if (status !== "running") return;
    const cwd = sessionCwd(agent?.session);
    if (cwd === void 0 || !isTaskCwd(registry.rootDir, cwd)) return;
    void (async () => {
      await ensureReady();
      const task = await registry.resolveByDir(cwd);
      if (task !== void 0) await registry.touch(task.id);
    })().catch(() => {});
  });

  // ── Fenced JSON API (`/task-runner/api/<method>`) ───────────────────────
  const fence = (req) => isTrustedApiRequest(req, ctx.webRuntime.trustedHosts);
  const api = {
    "task.allocate": async (payload) => {
      await ensureReady();
      const task = await registry.allocate(optionalString(payload, "name"));
      return { id: task.id, name: task.name, dir: task.dir };
    },
    "task.list": async () => {
      await ensureReady();
      return { items: registry.list() };
    },
    "task.attach": async (payload) => {
      await ensureReady();
      return registry.attach(requireString(payload, "id"), requireString(payload, "sessionId"));
    },
    "task.rename": async (payload) => {
      await ensureReady();
      return registry.rename(requireString(payload, "id"), requireString(payload, "name"));
    },
    "task.cleanup": async (payload) => {
      await ensureReady();
      const id = optionalString(payload, "id");
      const all = payload?.all === true;
      if (id === void 0 && !all) throw new ApiError("bad-request", 'missing "id" or "all"');
      return registry.cleanup({
        id,
        all,
        force: optionalBoolean(payload, "force") === true
      });
    }
  };
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: "/task-runner/api",
        handler: async (req, res) => {
          if (!fence(req)) {
            writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
            return;
          }
          if (req.method !== "POST") {
            writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
            return;
          }
          const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
          const method = pathname.startsWith("/task-runner/api/")
            ? pathname.slice("/task-runner/api/".length)
            : void 0;
          if (method === void 0 || method.includes("/")) {
            writeError(res, new ApiError("not-found", "unknown task-runner API method", 404));
            return;
          }
          try {
            const payload = await readJsonBody(req);
            const handler = api[method];
            if (handler === void 0) {
              throw new ApiError("not-found", `unknown task-runner API method "${method}"`, 404);
            }
            writeOk(res, await handler(payload));
          } catch (error) {
            writeError(res, error);
          }
        }
      }),
    "task-runner: /task-runner/api routes"
  );

  // ── `/task` command surface ─────────────────────────────────────────────
  const usage = "用法：/task list | /task new <名称> | /task open <名称|id> | /task clean [名称|id]";
  ctx.commands.register({
    name: "task",
    description: "管理 dsh 任务会话（不绑定工作区的临时目录会话）",
    input: { hint: "list | new <名称> | open <名称|id> | clean [名称|id]" },
    handler: async (invocation) => {
      const tokens = String(invocation.rawInput ?? "").trim().split(/\s+/u).filter(Boolean);
      const verb = tokens[0];
      const rest = tokens.slice(1);
      try {
        await ensureReady();
        switch (verb) {
          case void 0:
          case "list":
          case "ls": {
            const items = registry.list();
            if (items.length === 0) {
              return { kind: "success", text: "暂无任务。用任务面板或 /task new <名称> 创建一个。" };
            }
            const lines = items.map((task) => {
              const state = task.status === "active"
                ? (task.sessionId === null ? "活跃" : `会话 ${task.sessionId.slice(0, 12)}…`)
                : task.status;
              return `  [${task.status}] ${task.name}  →  ${task.dir}  (${state})`;
            });
            return { kind: "success", text: `任务列表（${items.length}）：\n${lines.join("\n")}` };
          }
          case "new": {
            const task = await registry.allocate(rest[0]);
            return {
              kind: "success",
              text: [
                `已创建任务「${task.name}」`,
                `  目录：${task.dir}`,
                "在侧边栏底部的任务面板点「打开」即可进入该任务会话。"
              ].join("\n")
            };
          }
          case "open": {
            if (rest.length !== 1) return { kind: "error", text: usage };
            const task = findTask(registry, rest[0]);
            if (task === void 0) return { kind: "error", text: `未找到任务「${rest[0]}」` };
            return {
              kind: "success",
              text: [
                `任务「${task.name}」`,
                `  目录：${task.dir}`,
                task.sessionId === null
                  ? "  尚无会话：在任务面板点「打开」新建会话。"
                  : `  会话：${task.sessionId}（在任务面板点「打开」进入）`
              ].join("\n")
            };
          }
          case "clean":
          case "cleanup": {
            const target = rest[0];
            const result = target === void 0
              ? await registry.cleanup({ all: true })
              : await registry.cleanup({ id: findTask(registry, target)?.id });
            const parts = [];
            if (result.removed.length > 0) parts.push(`已清理：${result.removed.join("、")}`);
            if (result.refused.length > 0) parts.push(`已拒绝（仍有活跃会话）：${result.refused.join("、")}`);
            return { kind: "success", text: parts.length > 0 ? parts.join("；") : "没有可清理的任务。" };
          }
          default:
            return { kind: "error", text: `未知 /task 子命令「${verb}」。\n${usage}` };
        }
      } catch (error) {
        if (error instanceof TaskNotFoundError) return { kind: "error", text: error.message };
        throw error;
      }
    }
  });
}

/** Resolve a task by id or by name prefix. */
function findTask(registry, token) {
  const byId = registry.get(token);
  if (byId !== void 0) return byId;
  return registry.list().find((task) => task.name === token || task.name.startsWith(token));
}

/** Re-export for plugins that want the path rule. */
export { withinRoot };
