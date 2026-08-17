import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TaskRegistry,
  sanitizeName,
  withinRoot,
  manifestPathOf
} from "../lib/registry.js";

async function makeRegistry() {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsh-task-test-"));
  const registry = new TaskRegistry({ rootDir: root });
  await registry.init();
  return { root, registry };
}

test("sanitizeName: trims, illegal chars, empty fallback, length cap", () => {
  assert.equal(sanitizeName("  任务 A  "), "任务 A");
  assert.equal(sanitizeName('a/b\\c:d*e?f"g<h>i|j'), "a_b_c_d_e_f_g_h_i_j");
  assert.equal(sanitizeName("   "), "task");
  assert.equal(sanitizeName("一二三四五六七八九十", 4), "一二三四");
});

test("withinRoot: root and children pass, siblings fail", () => {
  const base = path.join(os.tmpdir(), "dsh-within-root");
  assert.equal(withinRoot(base, base), true);
  assert.equal(withinRoot(base, path.join(base, "a")), true);
  assert.equal(withinRoot(base, base + "y"), false);
  assert.equal(withinRoot(base, path.join(base, "..", "y")), false);
});

test("allocate: creates directory, registers with timestamp name, attach works", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate("demo");
  assert.equal(task.name, "demo");
  assert.ok(task.dir.startsWith(path.join(root, "demo-")), `dir ${task.dir}`);
  assert.equal(task.status, "active");
  assert.equal((await stat(task.dir)).isDirectory(), true);
  const view = registry.get(task.id);
  assert.equal(view.id, task.id);
  assert.equal(registry.list().length, 1);
  // attach
  const attached = await registry.attach(task.id, "session-abc");
  assert.equal(attached.sessionId, "session-abc");
  assert.equal(registry.get(task.id).sessionId, "session-abc");
  await rm(root, { recursive: true, force: true });
});

test("allocate: empty name falls back to task-<stamp>", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate("");
  assert.equal(task.name, "task");
  assert.ok(path.basename(task.dir).startsWith("task-"));
  await rm(root, { recursive: true, force: true });
});

test("allocate: same-second collision gets a numeric suffix", async () => {
  const { root, registry } = await makeRegistry();
  const a = await registry.allocate("x");
  const b = await registry.allocate("x");
  assert.notEqual(a.dir, b.dir);
  assert.ok(path.basename(b.dir).startsWith("x-"));
  assert.ok(/-2$/u.test(path.basename(b.dir)) || path.basename(b.dir) !== path.basename(a.dir));
  await rm(root, { recursive: true, force: true });
});

test("resolveByDir finds by any spelling", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate("dir");
  const found = await registry.resolveByDir(path.join(root, path.basename(task.dir)));
  assert.equal(found.id, task.id);
  await rm(root, { recursive: true, force: true });
});

test("detach: session released, directory kept, status finished", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate("keep");
  await registry.attach(task.id, "session-1");
  await registry.detach(task.id);
  const view = registry.get(task.id);
  assert.equal(view.sessionId, null);
  assert.equal(view.status, "finished");
  assert.equal((await stat(task.dir)).isDirectory(), true);
  await rm(root, { recursive: true, force: true });
});

test("rename: directory renamed, record updated, timestamp preserved", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate("oldname");
  const stampSuffix = path.basename(task.dir).slice("oldname".length);
  const renamed = await registry.rename(task.id, "newname");
  assert.equal(renamed.name, "newname");
  assert.ok(path.basename(renamed.dir).startsWith(`newname${stampSuffix}`));
  assert.equal((await stat(renamed.dir)).isDirectory(), true);
  // old dir gone
  await assert.rejects(stat(task.dir));
  await rm(root, { recursive: true, force: true });
});

test("cleanup: refuses active without force, removes finished with force", async () => {
  const { root, registry } = await makeRegistry();
  const active = await registry.allocate("active");
  const done = await registry.allocate("done");
  await registry.detach(done.id);
  // refuse active
  const refused = await registry.cleanup({ all: true });
  assert.deepEqual(refused.refused, ["active"]);
  assert.deepEqual(refused.removed, ["done"]);
  assert.equal((await stat(active.dir)).isDirectory(), true);
  await assert.rejects(stat(done.dir));
  // force clears the rest
  const forced = await registry.cleanup({ all: true, force: true });
  assert.deepEqual(forced.removed, ["active"]);
  await assert.rejects(stat(active.dir));
  assert.equal(registry.list().length, 0);
  await rm(root, { recursive: true, force: true });
});

test("adopt: registers an existing directory, rejects outside root", async () => {
  const { root, registry } = await makeRegistry();
  const dir = path.join(root, "manual-20260816-120000");
  await mkdir(dir);
  const task = await registry.adopt(dir, "session-9");
  assert.equal(task.name, "manual");
  assert.equal(task.sessionId, "session-9");
  assert.equal(task.status, "active");
  // outside root
  const outside = await mkdtemp(path.join(os.tmpdir(), "dsh-task-outside-"));
  await assert.rejects(() => registry.adopt(outside));
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

test("adopt refuses the task root itself", async () => {
  const { root, registry } = await makeRegistry();
  await assert.rejects(
    () => registry.adopt(root, "session-root"),
    /task root itself/u
  );
  assert.equal(registry.list().length, 0);
  await rm(root, { recursive: true, force: true });
});

test("cleanup of a root-dir record only drops the record, never the root", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate("ok");
  await registry.detach(task.id);
  // Simulate the legacy mis-registration: a record pointing at the root.
  const manifest = JSON.parse(await readFile(manifestPathOf(root), "utf8"));
  manifest.tasks["root-record"] = {
    id: "root-record",
    name: "dsh_working",
    dir: root,
    sessionId: null,
    status: "finished",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await writeFile(manifestPathOf(root), JSON.stringify(manifest));
  const reloaded = new TaskRegistry({ rootDir: root });
  await reloaded.init();
  const result = await reloaded.cleanup({ all: true });
  assert.ok(result.removed.some((name) => name.includes("dsh_working")), `removed: ${result.removed.join(",")}`);
  assert.equal((await stat(root)).isDirectory(), true, "root directory survives");
  assert.equal(reloaded.list().length, 0);
  await rm(root, { recursive: true, force: true });
});

test("reconcile: deleted directory marked missing after reload", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate("gone");
  await rm(task.dir, { recursive: true, force: true });
  // fresh registry over the same root
  const second = new TaskRegistry({ rootDir: root });
  await second.init();
  assert.equal(second.get(task.id).status, "missing");
  await rm(root, { recursive: true, force: true });
});

test("manifest persists across instances", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsh-task-persist-"));
  const first = new TaskRegistry({ rootDir: root });
  await first.init();
  const task = await first.allocate("persist");
  const second = new TaskRegistry({ rootDir: root });
  await second.init();
  const view = second.get(task.id);
  assert.equal(view.dir, task.dir);
  assert.ok((await readFile(manifestPathOf(root), "utf8")).includes('"persist"'));
  await rm(root, { recursive: true, force: true });
});

test("adopt is idempotent for an already-registered directory", async () => {
  const { root, registry } = await makeRegistry();
  const dir = path.join(root, "manual-20260816-120000");
  await mkdir(dir);
  const first = await registry.adopt(dir, "session-1");
  const second = await registry.adopt(dir, "session-2");
  assert.equal(second.id, first.id);
  assert.equal(second.sessionId, "session-2");
  assert.equal(registry.list().length, 1);
  await rm(root, { recursive: true, force: true });
});

test("allocate sanitizes illegal characters and preserves Chinese names", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate(' 测试/任务:名称 ');
  assert.equal(task.name, "测试_任务_名称");
  assert.ok(path.basename(task.dir).startsWith("测试_任务_名称-"));
  await rm(root, { recursive: true, force: true });
});

test("cleanup removes a single task by id", async () => {
  const { root, registry } = await makeRegistry();
  const keep = await registry.allocate("keep");
  const drop = await registry.allocate("drop");
  await registry.detach(drop.id);
  const result = await registry.cleanup({ id: drop.id });
  assert.deepEqual(result.removed, ["drop"]);
  assert.deepEqual(result.refused, []);
  assert.ok(registry.get(drop.id) === void 0);
  assert.ok(registry.get(keep.id) !== void 0);
  assert.equal((await stat(keep.dir)).isDirectory(), true);
  await rm(root, { recursive: true, force: true });
});

test("attach returns updated view with session binding", async () => {
  const { root, registry } = await makeRegistry();
  const task = await registry.allocate("bind");
  const attached = await registry.attach(task.id, "session-xyz");
  assert.equal(attached.sessionId, "session-xyz");
  assert.equal(attached.status, "active");
  assert.ok(attached.lastActiveAt >= attached.createdAt);
  await rm(root, { recursive: true, force: true });
});

test("allocate respects nameMaxLength config", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsh-task-len-"));
  const registry = new TaskRegistry({ rootDir: root, nameMaxLength: 6 });
  await registry.init();
  const task = await registry.allocate("一二三四五六七八九");
  assert.equal(task.name, "一二三四五六");
  assert.ok(path.basename(task.dir).startsWith("一二三四五六-"));
  await rm(root, { recursive: true, force: true });
});
