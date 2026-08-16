// Simulate the browser ModuleLoader environment to verify our client.js
// factory + apply run without throwing and publish window.__dshTaskRunner.
import { readFile } from "node:fs/promises";

const listeners = new Set();
const state = { root: null, host: null, visible: false };

const fakeRoot = {
  render() {},
  unmount() {}
};
const fakeHost = { parentNode: { removeChild() {} } };

globalThis.window = {};
globalThis.document = {
  body: { appendChild() {} },
  createElement() { return fakeHost; },
  addEventListener() {}
};
globalThis.__dshTaskRunner = undefined;

const loaded = {};
const modules = {
  react: {
    createElement: (...a) => ({ tag: "el", a }),
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useCallback: (f) => f
  },
  "react-dom/client": { createRoot: () => fakeRoot }
};
function mockRequire(id) {
  if (!(id in modules)) throw new Error(`mock require: unknown module "${id}"`);
  return modules[id];
}

const src = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
const loadCall = /window\.__ModuleLoader__\.load\((\{[\s\S]*\})\);?$/.exec(src.trim());
if (!loadCall) throw new Error("no ModuleLoader.load call found");
const spec = eval(`(${loadCall[1]})`);
if (spec.id !== "dsh-task-runner") throw new Error(`unexpected id ${spec.id}`);

let threw = null;
try {
  const module = { exports: {} };
  const factoryReturn = spec.factory(mockRequire);
  loaded.apply = factoryReturn.apply;
  loaded.inject = factoryReturn.inject;
  if (typeof factoryReturn.apply !== "function" || !Array.isArray(factoryReturn.inject)) {
    throw new Error("factory did not export apply/inject");
  }
  // Minimal cordis ctx face
  const ctx = {
    effect: (fn) => { const d = fn(); return () => d && d(); },
    sessions: {
      create: async () => ({ ok: true, value: { sessionId: "session-mock" } }),
      open: () => {},
      binding: () => ({ session: { id: "session-mock" } })
    },
    workspaces: { list: { getSnapshot: () => ({ items: [] }) } }
  };
  factoryReturn.apply(ctx);
} catch (error) {
  threw = error;
}

console.log("factory apply exported:", typeof loaded.apply === "function");
console.log("inject:", JSON.stringify(loaded.inject));
console.log("__dshTaskRunner published:", typeof globalThis.window.__dshTaskRunner);
if (globalThis.window.__dshTaskRunner) {
  console.log("createTask fn:", typeof globalThis.window.__dshTaskRunner.createTask);
  console.log("openPanel fn:", typeof globalThis.window.__dshTaskRunner.openPanel);
}
if (threw) {
  console.error("THREW:", threw.message);
  process.exit(1);
}
if (typeof globalThis.window.__dshTaskRunner?.createTask !== "function") {
  console.error("FAIL: __dshTaskRunner.createTask missing");
  process.exit(1);
}
console.log("CLIENT LOAD SIMULATION: PASS");
