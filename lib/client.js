/**
 * dsh-task-runner — client half.
 *
 * Provides the "task" (no-workspace) conversation flow to the OFFICIAL
 * sidebar, without adding any custom button of its own:
 *
 * - The official sidebar's "任务" group "+" button calls
 *   `window.__dshTaskRunner.createTask()` to start a session with no
 *   workspace (fresh scratch dir under the task root).
 * - The official workspace picker's "无工作区（任务）" entry calls the same.
 *
 * The task panel (named tasks, list, cleanup) is a floating overlay opened
 * via `openPanel()` (and the `/task` command).
 */
window.__ModuleLoader__.load({
	id: "dsh-task-runner",
	factory: (require) => {
		"use strict";
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const { createElement, useState, useEffect, useCallback } = react;
		const { createRoot } = require("react-dom/client");

		/** Services required before mounting. */
		const inject = ["slots", "sessions", "workspaces"];

		// ── Module-level panel state (shared across roots) ───────────────────
		const panel = { host: null, root: null, visible: false, listeners: new Set() };

		// ── Visible toast (diagnostic + user feedback) ───────────────────────
		let toastTimer = null;
		function showToast(message, kind) {
			if (typeof document === "undefined") return;
			let el = document.querySelector("[data-dsh-task-toast]");
			if (el === null) {
				el = document.createElement("div");
				el.setAttribute("data-dsh-task-toast", "");
				el.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483100;max-width:70vw;padding:8px 14px;border-radius:8px;font:12px/1.5 ui-sans-serif,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.45);transition:opacity .2s ease";
				document.body.appendChild(el);
			}
			el.textContent = message;
			el.style.background = kind === "error" ? "rgba(122,32,32,.96)" : "rgba(28,28,34,.98)";
			el.style.color = kind === "error" ? "#ffd7d7" : "rgba(235,235,240,.95)";
			el.style.border = kind === "error" ? "1px solid #f2a1a1" : "1px solid rgba(127,127,137,.4)";
			el.style.opacity = "1";
			if (toastTimer !== null) clearTimeout(toastTimer);
			toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 4000);
		}
		/** Wait until the client knows the session (summaries/binding), then open it. */
		async function openWhenReady(ctx, sessionId) {
			for (let i = 0; i < 30; i += 1) {
				try {
					if (ctx.sessions.binding(sessionId) !== void 0 || ctx.sessions.list?.getSnapshot?.().byId?.[sessionId] !== void 0) {
						ctx.sessions.open(sessionId);
						return true;
					}
				} catch { /* keep polling */ }
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			ctx.sessions.open(sessionId);
			return true;
		}

		function setVisible(state, visible) {
			state.visible = visible;
			for (const listener of state.listeners) listener();
		}
		function useVisible(state) {
			const [visible, setVisibleState] = useState(state.visible);
			useEffect(() => {
				const listener = () => setVisibleState(state.visible);
				state.listeners.add(listener);
				return () => { state.listeners.delete(listener); };
			}, []);
			return visible;
		}
		/** Mount a React root into a body host once (waits for document.body). */
		function ensureRoot(state, ctx, render) {
			if (state.root !== null) return;
			if (typeof document === "undefined" || document.body === null) {
				if (typeof document !== "undefined") {
					document.addEventListener("DOMContentLoaded", () => ensureRoot(state, ctx, render), { once: true });
				}
				return;
			}
			state.host = document.createElement("div");
			document.body.appendChild(state.host);
			state.root = createRoot(state.host);
			state.root.render(createElement(render, { ctx }));
		}

		// ── Fenced API wrapper ───────────────────────────────────────────────
		async function call(method, payload) {
			let response;
			try {
				response = await fetch(`/task-runner/api/${method}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload || {})
				});
			} catch (error) {
				throw new Error(`task API unreachable: ${error instanceof Error ? error.message : String(error)}`);
			}
			const parsed = await response.json().catch(() => null);
			if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
				throw new Error((parsed && parsed.error && parsed.error.message) || `HTTP ${response.status}`);
			}
			return parsed.value;
		}

		// ── Shared styles ────────────────────────────────────────────────────
		const OVERLAY_STYLE = {
			position: "fixed",
			right: 16,
			bottom: 48,
			width: 380,
			maxWidth: "calc(100vw - 32px)",
			maxHeight: "75vh",
			overflow: "auto",
			zIndex: 2147483000,
			background: "rgba(28,28,34,.98)",
			border: "1px solid rgba(127,127,137,.4)",
			borderRadius: 12,
			boxShadow: "0 12px 40px rgba(0,0,0,.5)",
			color: "rgba(235,235,240,.95)",
			font: "13px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif",
			padding: 14
		};
		const BTN = {
			border: "1px solid rgba(127,127,137,.4)",
			background: "transparent",
			color: "inherit",
			borderRadius: 6,
			padding: "5px 10px",
			fontSize: 12,
			cursor: "pointer"
		};
		const PRIMARY_BTN = {
			...BTN,
			background: "rgba(90,150,255,.18)",
			borderColor: "rgba(90,150,255,.5)"
		};

		// ── Task panel (named tasks, list, cleanup) ──────────────────────────
		function statusLabel(status) {
			switch (status) {
				case "active": return "活跃";
				case "finished": return "已结束";
				case "missing": return "目录丢失";
				default: return status;
			}
		}

		function PanelBody({ ctx }) {
			const [items, setItems] = useState([]);
			const [name, setName] = useState("");
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState(null);

			const refresh = useCallback(() => {
				call("task.list").then((value) => {
					setItems(Array.isArray(value.items) ? value.items : []);
				}).catch((err) => setError(String(err)));
			}, []);

			useEffect(() => { refresh(); }, [refresh]);

			const handleCreate = useCallback(async () => {
				if (busy) return;
				setBusy(true);
				setError(null);
				try {
					const task = await call("task.allocate", { name: name.trim() === "" ? void 0 : name.trim() });
					const result = await ctx.sessions.create({ cwd: task.dir });
					if (!result.ok) throw new Error(result.error?.message ?? "session create failed");
					const sessionId = result.value.sessionId;
					try {
						await call("task.attach", { id: task.id, sessionId });
					} catch { /* host hook backfills on session/created */ }
					setName("");
					setVisible(panel, false);
					ctx.sessions.open(sessionId);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}, [busy, name, ctx]);

			const handleOpen = useCallback(async (task) => {
				if (busy) return;
				setBusy(true);
				setError(null);
				try {
					let sessionId = task.sessionId;
					if (sessionId !== null && ctx.sessions.binding(sessionId) !== void 0) {
						ctx.sessions.open(sessionId);
						setVisible(panel, false);
						return;
					}
					const result = await ctx.sessions.create({ cwd: task.dir });
					if (!result.ok) throw new Error(result.error?.message ?? "session create failed");
					sessionId = result.value.sessionId;
					try {
						await call("task.attach", { id: task.id, sessionId });
					} catch { /* best effort */ }
					setVisible(panel, false);
					ctx.sessions.open(sessionId);
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}, [busy, ctx]);

			const handleCleanup = useCallback(async (task) => {
				if (busy) return;
				setBusy(true);
				setError(null);
				try {
					const result = await call("task.cleanup", { id: task.id });
					if (result.refused && result.refused.length > 0) {
						setError(`任务仍处于活跃状态：${result.refused.join("、")}`);
					}
					refresh();
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}, [busy, refresh]);

			const handleCleanupAll = useCallback(async () => {
				if (busy) return;
				setBusy(true);
				setError(null);
				try {
					const result = await call("task.cleanup", { all: true });
					if (result.refused && result.refused.length > 0) {
						setError(`已拒绝清理活跃任务：${result.refused.join("、")}`);
					}
					refresh();
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err));
				} finally {
					setBusy(false);
				}
			}, [busy, refresh]);

			return createElement(
				"div",
				null,
				createElement("div", {
					style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }
				},
					createElement("div", { style: { fontWeight: 600, fontSize: 14 } }, "任务面板"),
					createElement("button", {
						type: "button",
						onClick: () => setVisible(panel, false),
						title: "关闭",
						style: { ...BTN, padding: "2px 8px" }
					}, "✕")
				),
				createElement("div", { style: { display: "flex", gap: 6, marginBottom: 10 } },
					createElement("input", {
						type: "text",
						value: name,
						placeholder: "任务名称（留空自动命名）",
						onChange: (event) => setName(event.target.value),
						onKeyDown: (event) => {
							if (event.key === "Enter") handleCreate();
						},
						style: {
							flex: 1,
							background: "rgba(127,127,137,.12)",
							border: "1px solid rgba(127,127,137,.35)",
							color: "inherit",
							borderRadius: 6,
							padding: "6px 8px",
							fontSize: 12,
							outline: "none"
						}
					}),
					createElement("button", {
						type: "button",
						onClick: handleCreate,
						disabled: busy,
						style: PRIMARY_BTN
					}, busy ? "…" : "新建")
				),
				error !== null
					? createElement("div", { style: { color: "#f2a1a1", fontSize: 12, marginBottom: 8, whiteSpace: "pre-wrap" } }, error)
					: null,
				items.length === 0
					? createElement("div", { style: { color: "rgba(235,235,240,.5)", fontSize: 12, padding: "6px 2px" } },
						"暂无任务。输入名称点「新建」，会在 D:\\dsh_working 下创建独立目录并打开新会话。")
					: createElement(
						"div",
						null,
						items.map((task) => createElement(
							"div",
							{ key: task.id, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(127,127,137,.22)", marginBottom: 8 } },
							createElement("div", { style: { minWidth: 0 } },
								createElement("div", { style: { fontWeight: 600, fontSize: 12.5 } }, task.name),
								createElement("div", { style: { color: "rgba(235,235,240,.55)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, task.dir),
								createElement("div", { style: { color: "rgba(235,235,240,.45)", fontSize: 11, marginTop: 2 } },
									`${statusLabel(task.status)} · ${new Date(task.createdAt).toLocaleString()}`)
							),
							createElement("div", { style: { display: "flex", gap: 6, flexShrink: 0 } },
								createElement("button", { type: "button", onClick: () => handleOpen(task), disabled: busy, style: BTN }, "打开"),
								createElement("button", { type: "button", onClick: () => handleCleanup(task), disabled: busy, style: { ...BTN, color: "#f2a1a1" } }, "清理")
							)
						)),
						createElement("button", {
							type: "button",
							onClick: handleCleanupAll,
							disabled: busy,
							style: { ...BTN, width: "100%", marginTop: 4, color: "rgba(235,235,240,.75)" }
						}, "清理全部已结束任务")
					)
			);
		}

		function Panel({ ctx }) {
			const visible = useVisible(panel);
			if (!visible) return null;
			return createElement("div", { style: OVERLAY_STYLE }, createElement(PanelBody, { ctx }));
		}

		/**
		 * Plugin body: mounts the panel root and exposes the global task entry
		 * the official sidebar / workspace picker call.
		 * @param ctx - client root context (slots, sessions, workspaces).
		 */
		function apply(ctx) {
			ctx.effect(() => () => {
				if (panel.root !== null) {
					panel.root.unmount();
					panel.root = null;
				}
				if (panel.host !== null && panel.host.parentNode !== null) {
					panel.host.parentNode.removeChild(panel.host);
					panel.host = null;
				}
				setVisible(panel, false);
			}, "dsh-task-runner: roots teardown");

			ensureRoot(panel, ctx, Panel);

			window.__dshTaskRunner = {
				get panelVisible() { return panel.visible; },
				openPanel: () => setVisible(panel, true),
				closeAll: () => setVisible(panel, false),
				showToast,
				/**
				 * Whether a directory belongs to the task root (default
				 * D:\dsh_working). Used by the official sidebar to keep blank
				 * task sessions visible.
				 */
				isTaskDir: (cwd) => {
					return typeof cwd === "string" && cwd !== ""
						&& cwd !== "D:\\dsh_working" && cwd !== "D:/dsh_working"
						&& (cwd.startsWith("D:\\dsh_working\\") || cwd.startsWith("D:/dsh_working/"));
				},
				/**
				 * Called by the official "任务" group "+" button and the
				 * workspace picker's "无工作区（任务）" entry: create a task
				 * session immediately (no workspace, no dialog).
				 * @returns {Promise<{sessionId: string, dir: string} | null>}
				 */
				createTask: async () => {
					showToast("正在创建任务会话…", "info");
					const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
					try {
						const task = await call("task.allocate", {});
						const result = await ctx.sessions.create({ cwd: task.dir });
						let sessionId = result.ok === true ? result.value?.sessionId : null;
						if (sessionId === null || sessionId === void 0) {
							// The host may still have created the session (the
							// session/created hook attaches it): wait briefly and
							// resolve the id from the task manifest before giving up.
							console.warn("[dsh-task-runner] sessions.create result:", JSON.stringify(result));
							for (let i = 0; i < 15; i += 1) {
								await sleep(100);
								try {
									const list = await call("task.list");
									const t = (list.items || []).find((x) => x.id === task.id);
									if (t !== void 0 && t.sessionId !== null) {
										sessionId = t.sessionId;
										break;
									}
								} catch { /* transient */ }
							}
						}
						if (sessionId === null || sessionId === void 0) {
							throw new Error(`session create failed (${JSON.stringify(result)})`);
						}
						try {
							await call("task.attach", { id: task.id, sessionId });
						} catch { /* host hook backfills on session/created */ }
						// Refresh the client session list from the host so the
						// new session (with its cwd) appears in the sidebar Tasks
						// group even when the create result was misreported.
						if (typeof ctx.sessions.refresh === "function") {
							try { await ctx.sessions.refresh(); } catch { /* best effort */ }
						}
						setVisible(panel, false);
						await openWhenReady(ctx, sessionId);
						showToast("已打开任务会话", "info");
						return { sessionId, dir: task.dir };
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						console.error("[dsh-task-runner] createTask failed:", error);
						showToast(`创建任务会话失败：${message}`, "error");
						return null;
					}
				}
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
