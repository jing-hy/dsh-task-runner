// Host-side integration smoke: mount the plugin on a mock ctx, capture the
// /task-runner/api handler, then drive task.allocate / task.list /
// task.cleanup through a fake HTTP request/response pair against a temp root.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apply } from "../lib/index.js";

const root = await mkdtemp(path.join(os.tmpdir(), "dsh-task-mount-"));
const rootDir = path.join(root, "working");

/** Minimal node IncomingMessage stand-in (async-iterable body). */
function fakeReq({ method = "POST", url = "/task-runner/api/task.allocate", body = {}, headers = {} } = {}) {
  const req = {
    method,
    url,
    headers: {
      host: "127.0.0.1:12345",
      origin: "http://127.0.0.1:12345",
      ...headers
    },
    [Symbol.asyncIterator]() {
      const text = JSON.stringify(body);
      let done = false;
      return {
        next: async () => {
          if (done) return { done: true, value: undefined };
          done = true;
          return { done: false, value: Buffer.from(text, "utf8") };
        }
      };
    }
  };
  return req;
}

function fakeRes() {
  const chunks = [];
  return {
    _status: 0,
    _headers: null,
    writeHead(status, headers) {
      this._status = status;
      this._headers = headers;
    },
    end(payload) {
      this._payload = String(payload);
      chunks.push(this._payload);
    },
    get body() {
      return chunks.length === 0 ? null : JSON.parse(chunks.join(""));
    }
  };
}

const registrations = { routes: [], on: [], commands: [], provides: [] };
const ctx = {
  provide: (key) => { registrations.provides.push(key); },
  on: (event) => { registrations.on.push(event); return () => {}; },
  effect: (fn) => { const disposer = fn(); return () => { if (typeof disposer === "function") disposer(); }; },
  webServer: {
    register: (route) => {
      registrations.routes.push(route);
      return () => {};
    }
  },
  webRuntime: { trustedHosts: [] },
  commands: { register: (command) => { registrations.commands.push(command); } },
  logger: { warn: () => {} }
};

apply(ctx, { rootDir, nameMaxLength: 40 });

assert.ok(registrations.provides.includes("taskRegistry"), "provides taskRegistry");
assert.ok(registrations.on.includes("session/created"), "hooks session/created");
assert.ok(registrations.on.includes("session/disposed"), "hooks session/disposed");
assert.ok(registrations.on.includes("agent/status"), "hooks agent/status");
assert.ok(registrations.commands.some((c) => c.name === "task"), "registers /task command");

const route = registrations.routes.find((r) => r.path === "/task-runner/api");
assert.ok(route, "registers /task-runner/api route");

async function apiCall(method, body) {
  const res = fakeRes();
  await route.handler(fakeReq({ url: `/task-runner/api/${method}`, body }), res);
  return res;
}

// allocate
let res = await apiCall("task.allocate", { name: "冒烟任务" });
assert.equal(res._status, 200, "allocate status");
assert.equal(res.body.ok, true, "allocate ok");
const allocated = res.body.value;
assert.ok(allocated.dir.startsWith(rootDir), `dir under root: ${allocated.dir}`);
assert.match(allocated.name, /^冒烟任务$/u);

// list
res = await apiCall("task.list", {});
assert.equal(res.body.ok, true);
assert.equal(res.body.value.items.length, 1);

// attach
res = await apiCall("task.attach", { id: allocated.id, sessionId: "session-smoke" });
assert.equal(res.body.value.sessionId, "session-smoke");

// rename
res = await apiCall("task.rename", { id: allocated.id, name: "改名" });
assert.equal(res.body.value.name, "改名");

// cleanup without force refuses active
res = await apiCall("task.cleanup", { all: true });
assert.equal(res.body.value.refused.length, 1, "refuses active");

// force cleanup
res = await apiCall("task.cleanup", { all: true, force: true });
assert.equal(res.body.value.removed.length, 1);

// fence: cross-site request refused
res = await apiCall("task.list", {}); // body empty
assert.equal(res.body.ok, true, "loopback passes fence");
const crossSite = fakeRes();
await route.handler(fakeReq({ url: "/task-runner/api/task.list", body: {}, headers: { "sec-fetch-site": "cross-site" } }), crossSite);
assert.equal(crossSite._status, 403, "cross-site refused");

console.log("host integration smoke: ALL PASS");
await rm(root, { recursive: true, force: true });
