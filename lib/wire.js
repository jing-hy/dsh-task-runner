// @ts-check
/**
 * dsh-task-runner — wire helpers for the `/task-runner/api` JSON API:
 * bounded body reading, response writing, and the shared error envelope.
 * Every method returns `{ok: true, value}` or `{ok: false, error:{code,message}}`.
 *
 * Structurally mirrors dsh-better-sidebar's wire.ts (same host webServer
 * face), reimplemented here so the plugin has no dependency on it.
 *
 * @module dsh-task-runner/wire
 */

/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 20;

/** One API failure with its wire code and HTTP status. */
export class ApiError extends Error {
  /**
   * @param {string} code - machine-readable error code.
   * @param {string} message - human-readable message.
   * @param {number} [status] - HTTP status (default 400).
   */
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Read and parse the JSON request body (bounded; malformed -> bad-request).
 * @param {import("node:http").IncomingMessage} req - the node request.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new ApiError("bad-request", "request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? parsed
      : { value: parsed };
  } catch {
    throw new ApiError("bad-request", "request body is not valid JSON");
  }
}

/**
 * Write a JSON response with the given status.
 * @param {import("node:http").ServerResponse} res - the node response.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serializable body.
 */
export function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

/** Write the success envelope. */
export function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value });
}

/** Write the failure envelope for any thrown value (unknown -> internal 500). */
export function writeError(res, error) {
  if (error instanceof ApiError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  writeJson(res, 500, { ok: false, error: { code: "internal", message } });
}

/**
 * Narrow an unknown payload value to a non-empty string, else throw bad-request.
 * @param {unknown} payload - parsed body.
 * @param {string} key - the field key.
 * @returns {string}
 */
export function requireString(payload, key) {
  const value = payload?.[key];
  if (typeof value !== "string" || value === "") {
    throw new ApiError("bad-request", `missing or invalid "${key}"`);
  }
  return value;
}

/**
 * Narrow an unknown payload value to an optional string.
 * @param {unknown} payload - parsed body.
 * @param {string} key - the field key.
 * @returns {string | undefined}
 */
export function optionalString(payload, key) {
  const value = payload?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Narrow an unknown payload value to an optional boolean.
 * @param {unknown} payload - parsed body.
 * @param {string} key - the field key.
 * @returns {boolean | undefined}
 */
export function optionalBoolean(payload, key) {
  const value = payload?.[key];
  return typeof value === "boolean" ? value : undefined;
}
