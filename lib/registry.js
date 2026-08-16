// @ts-check
/**
 * dsh-task-runner — TaskRegistry (host side).
 *
 * A task is a scratch conversation that does NOT attach to a DSH workspace:
 * each task gets a fresh directory under the task root (default
 * `D:\dsh_working`) named `<name>-<YYYYMMDD-HHmmss>`, and the session runs
 * with that directory as its `cwd`. The registry keeps a durable manifest
 * (`<root>/.tasks.json`) so tasks survive host restarts; a startup scan
 * reconciles directories that were deleted out from under us.
 *
 * Pure Node logic — no cordis dependency — so it is unit-testable in
 * isolation.
 *
 * @module dsh-task-runner/registry
 */
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

/** Manifest file name inside the task root. */
const MANIFEST_NAME = ".tasks.json";
/** Characters never allowed in a task name (Windows filename rules). */
const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
/** Default cap on the task-name segment. */
const DEFAULT_NAME_MAX = 40;

/**
 * Format a Date as a local-time `YYYYMMDD-HHmmss` stamp for directory names.
 * @param {Date} date - the instant to format.
 * @returns {string} the stamp.
 */
function stamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Sanitize a user-supplied task name for use as a directory segment.
 * - trims and collapses whitespace;
 * - replaces Windows-illegal characters with `_`;
 * - falls back to `task` when empty;
 * - caps the length (code points, not UTF-16 units).
 * @param {string} raw - raw user input.
 * @param {number} maxLength - maximum code-point length.
 * @returns {string} a safe name segment.
 */
export function sanitizeName(raw, maxLength = DEFAULT_NAME_MAX) {
  let name = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(INVALID_NAME_CHARS, "_");
  if (name === "") name = "task";
  const chars = [...name];
  if (chars.length > maxLength) name = chars.slice(0, maxLength).join("");
  return name;
}

/** Whether `candidate` is the task root itself or inside it. */
export function withinRoot(root, candidate) {
  const rp = path.resolve(root);
  const cp = path.resolve(candidate);
  return cp === rp || cp.startsWith(rp + path.sep);
}

/** Public shape of one task record (immutable snapshot for callers). */
export class TaskView {
  /** @param {import("./registry.js").TaskRecord} record */
  constructor(record) {
    this.id = record.id;
    this.name = record.name;
    this.dir = record.dir;
    this.sessionId = record.sessionId;
    this.status = record.status;
    this.createdAt = record.createdAt;
    this.lastActiveAt = record.lastActiveAt;
    this.updatedAt = record.updatedAt;
  }
}

/**
 * Task registry: durable manifest + directory lifecycle under one root.
 */
export class TaskRegistry {
  /**
   * @param {object} options
   * @param {string} options.rootDir - absolute task root directory.
   * @param {number} [options.nameMaxLength] - cap for the name segment.
   */
  constructor({ rootDir, nameMaxLength = DEFAULT_NAME_MAX } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.nameMaxLength = nameMaxLength;
    this.manifestPath = path.join(this.rootDir, MANIFEST_NAME);
    /** @type {Map<string, import("./registry.js").TaskRecord>} */
    this.tasks = new Map();
    /** @type {Map<string, string>} canonical dir -> task id */
    this.byDir = new Map();
    /** init promise (idempotent) */
    this.ready = null;
    /** write chain — manifest writes never interleave */
    this.writeTail = Promise.resolve();
  }

  /** Initialize once: ensure root, load manifest, reconcile directories. */
  init() {
    if (this.ready === null) this.ready = this.#init();
    return this.ready;
  }

  async #init() {
    await mkdir(this.rootDir, { recursive: true });
    await this.#load();
    await this.#reconcile();
  }

  async #load() {
    this.tasks.clear();
    this.byDir.clear();
    let text;
    try {
      text = await readFile(this.manifestPath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      throw new Error(`task-runner: cannot read manifest ${this.manifestPath}: ${String(error)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`task-runner: manifest ${this.manifestPath} is corrupt: ${String(error)}`);
    }
    const records = parsed?.tasks;
    if (typeof records !== "object" || records === null) {
      throw new Error(`task-runner: manifest ${this.manifestPath} has no tasks table`);
    }
    for (const [id, record] of Object.entries(records)) {
      if (typeof record?.dir !== "string") continue;
      this.tasks.set(id, record);
      this.byDir.set(path.resolve(record.dir), id);
    }
  }

  /** Persist the manifest atomically (temp file + rename) on the write chain. */
  #save() {
    const payload = JSON.stringify(
      { version: 1, tasks: Object.fromEntries(this.tasks) },
      null,
      2
    );
    this.writeTail = this.writeTail.then(async () => {
      const tmp = `${this.manifestPath}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, this.manifestPath);
    });
    return this.writeTail;
  }

  /**
   * Mark every registered task whose directory is gone as `missing`
   * (the record survives; cleanup can drop it later).
   */
  async #reconcile() {
    for (const record of this.tasks.values()) {
      try {
        const info = await stat(record.dir);
        if (!info.isDirectory()) record.status = "missing";
        else if (record.status === "missing") record.status = "finished";
      } catch {
        record.status = "missing";
      }
    }
    await this.#save();
  }

  /**
   * Create a fresh task: allocate a unique `<name>-<stamp>` directory
   * (collision-safe), mkdir it, and register the record. Status starts
   * `active`; the caller attaches the session afterwards.
   * @param {string} [name] - optional task name (sanitized; empty -> auto).
   * @returns {Promise<TaskView>} the created task view.
   */
  async allocate(name) {
    await this.init();
    const safe = sanitizeName(name, this.nameMaxLength);
    const base = `${safe}-${stamp(new Date())}`;
    let dir = path.join(this.rootDir, base);
    let suffix = 2;
    while (this.byDir.has(path.resolve(dir)) || await dirExists(dir)) {
      dir = path.join(this.rootDir, `${base}-${suffix}`);
      suffix += 1;
    }
    await mkdir(dir, { recursive: true });
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      name: safe,
      dir: path.resolve(dir),
      sessionId: null,
      status: "active",
      createdAt: now,
      lastActiveAt: now,
      updatedAt: now
    };
    this.tasks.set(record.id, record);
    this.byDir.set(record.dir, record.id);
    await this.#save();
    return new TaskView(record);
  }

  /**
   * Bind a session to a task (called by the session/created hook and the
   * client after `session.create`). Status becomes `active`.
   * @param {string} id - task id.
   * @param {string} sessionId - DSH session id.
   * @returns {Promise<TaskView>}
   */
  async attach(id, sessionId) {
    await this.init();
    const record = this.#require(id);
    record.sessionId = sessionId;
    record.status = "active";
    record.lastActiveAt = new Date().toISOString();
    record.updatedAt = record.lastActiveAt;
    await this.#save();
    return new TaskView(record);
  }

  /**
   * Release a task's session (session disposed). The directory is kept;
   * status becomes `finished`.
   * @param {string} id - task id.
   * @returns {Promise<TaskView>}
   */
  async detach(id) {
    await this.init();
    const record = this.#require(id);
    record.sessionId = null;
    record.status = record.status === "missing" ? "missing" : "finished";
    record.updatedAt = new Date().toISOString();
    await this.#save();
    return new TaskView(record);
  }

  /**
   * Adopt an existing directory under the root as a task (fallback path:
   * a session/created hook found a cwd inside the root that the registry
   * does not know about — e.g. the client created the session directly with
   * a cwd, or the manifest was reset). The task name is derived from the
   * directory name with the timestamp suffix stripped when it matches the
   * `<name>-<YYYYMMDD-HHmmss>` shape.
   * @param {string} dir - existing directory inside the root.
   * @param {string} [sessionId] - optional session to attach.
   * @returns {Promise<TaskView>} the adopted (or already-registered) task.
   */
  async adopt(dir, sessionId) {
    await this.init();
    const canonical = path.resolve(dir);
    if (!withinRoot(this.rootDir, canonical)) {
      throw new Error(`task-runner: refusing to adopt ${canonical}: outside the task root`);
    }
    if (canonical === this.rootDir) {
      throw new Error("task-runner: refusing to adopt the task root itself as a task");
    }
    const existing = this.resolveByDir(canonical);
    if (existing !== void 0) {
      if (sessionId !== void 0 && existing.sessionId !== sessionId) {
        return this.attach(existing.id, sessionId);
      }
      return existing;
    }
    if (!(await dirExists(canonical))) {
      throw new Error(`task-runner: cannot adopt ${canonical}: directory does not exist`);
    }
    const base = path.basename(canonical);
    const name = base.replace(/-\d{8}-\d{6}(?:-\d+)?$/u, "") || "task";
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      name,
      dir: canonical,
      sessionId: sessionId ?? null,
      status: sessionId === void 0 ? "finished" : "active",
      createdAt: now,
      lastActiveAt: now,
      updatedAt: now
    };
    this.tasks.set(record.id, record);
    this.byDir.set(record.dir, record.id);
    await this.#save();
    return new TaskView(record);
  }

  /**
   * Look up a task by id.
   * @param {string} id - task id.
   * @returns {TaskView | undefined}
   */
  get(id) {
    const record = this.tasks.get(id);
    return record === void 0 ? void 0 : new TaskView(record);
  }

  /**
   * Look up a task by canonical directory path.
   * @param {string} dir - directory path in any spelling.
   * @returns {TaskView | undefined}
   */
  resolveByDir(dir) {
    const id = this.byDir.get(path.resolve(dir));
    return id === void 0 ? void 0 : this.get(id);
  }

  /**
   * All tasks in creation order (newest last).
   * @returns {TaskView[]}
   */
  list() {
    return [...this.tasks.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((record) => new TaskView(record));
  }

  /**
   * Rename a task: rename its directory and update the manifest. The
   * timestamp suffix is preserved (`<newName>-<stamp>`); collisions are
   * suffixed numerically.
   * @param {string} id - task id.
   * @param {string} name - new task name (sanitized).
   * @returns {Promise<TaskView>}
   */
  async rename(id, name) {
    await this.init();
    const record = this.#require(id);
    const safe = sanitizeName(name, this.nameMaxLength);
    if (safe === record.name) return new TaskView(record);
    const oldDir = record.dir;
    const stampSuffix = path.basename(oldDir).slice(record.name.length);
    const base = `${safe}${stampSuffix}`;
    let dir = path.join(this.rootDir, base);
    let suffix = 2;
    while (this.byDir.has(path.resolve(dir)) || await dirExists(dir)) {
      dir = path.join(this.rootDir, `${base}-${suffix}`);
      suffix += 1;
    }
    await rename(oldDir, dir);
    this.byDir.delete(path.resolve(oldDir));
    record.name = safe;
    record.dir = path.resolve(dir);
    record.updatedAt = new Date().toISOString();
    this.byDir.set(record.dir, id);
    await this.#save();
    return new TaskView(record);
  }

  /**
   * Delete task directories and their registrations.
   * @param {object} options
   * @param {string} [options.id] - delete one task.
   * @param {boolean} [options.all] - delete every task.
   * @param {boolean} [options.force] - allow deleting `active` tasks.
   * @returns {Promise<{removed: string[], refused: string[]}>}
   */
  async cleanup({ id, all = false, force = false } = {}) {
    await this.init();
    /** @type {string[]} */
    const removed = [];
    /** @type {string[]} */
    const refused = [];
    const targets = all
      ? [...this.tasks.values()]
      : id !== void 0
        ? [this.#require(id)]
        : [];
    for (const record of targets) {
      if (record.dir === this.rootDir) {
        // The root itself is never a task directory: drop the record only,
        // never touch the root's contents.
        this.tasks.delete(record.id);
        this.byDir.delete(path.resolve(record.dir));
        removed.push(`${record.name} (仅注销记录)`);
        continue;
      }
      if (record.status === "active" && !force) {
        refused.push(record.name);
        continue;
      }
      try {
        await rm(record.dir, { recursive: true, force: true });
      } catch (error) {
        throw new Error(`task-runner: cannot remove ${record.dir}: ${String(error)}`);
      }
      this.tasks.delete(record.id);
      this.byDir.delete(path.resolve(record.dir));
      removed.push(record.name);
    }
    if (removed.length > 0) await this.#save();
    return { removed, refused };
  }

  /** Touch activity time (session agent ran). */
  async touch(id) {
    const record = this.tasks.get(id);
    if (record === void 0) return;
    record.lastActiveAt = new Date().toISOString();
    await this.#save();
  }

  #require(id) {
    const record = this.tasks.get(id);
    if (record === void 0) throw new TaskNotFoundError(id);
    return record;
  }
}

/** A task id that is not registered. */
export class TaskNotFoundError extends Error {
  /**
   * @param {string} id - the unknown task id.
   */
  constructor(id) {
    super(`no registered task "${id}"`);
    this.name = "TaskNotFoundError";
  }
}

/** @param {string} p */
async function dirExists(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Read the manifest path a registry would use (for tests/tools). */
export function manifestPathOf(rootDir) {
  return path.join(path.resolve(rootDir), MANIFEST_NAME);
}
