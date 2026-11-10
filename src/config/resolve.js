import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { PRESET_PREFIX, PRESETS } from "./presets.js";

const MAX_DEPTH = 10;
const REMOTE_TTL_MS = 24 * 60 * 60 * 1000;
const REMOTE_TIMEOUT_MS = 5000;

// A personal .commitconfig.local.json may change only these, so it can never loosen team rules.
export const LOCAL_ALLOWED_AI_KEYS = ["enabled", "model", "sendDiff", "askByDefault"];

export class ConfigResolveError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Merges `override` onto `base`. Objects merge key by key, arrays and values are
 * replaced, and a "key+" entry appends to the inherited "key" list instead.
 * `sources` records which label last set each top-level key (and each ai.* key).
 */
export function mergeConfigs(base, override, label, sources = {}, prefix = "") {
  const result = { ...base };
  for (const [rawKey, value] of Object.entries(override)) {
    if (rawKey === "extends" || rawKey === "$schema") continue;

    if (rawKey.endsWith("+")) {
      const key = rawKey.slice(0, -1);
      if (!Array.isArray(value)) {
        throw new ConfigResolveError(`"${prefix}${rawKey}" must be a list.`);
      }
      const inherited = Array.isArray(result[key]) ? result[key] : [];
      result[key] = [...new Set([...inherited, ...value])];
      sources[`${prefix}${key}`] = sources[`${prefix}${key}`] ? `${sources[`${prefix}${key}`]} + ${label}` : label;
      continue;
    }

    if (isPlainObject(value) && isPlainObject(result[rawKey])) {
      result[rawKey] = mergeConfigs(result[rawKey], value, label, sources, `${prefix}${rawKey}.`);
      continue;
    }

    result[rawKey] = value;
    if (isPlainObject(value)) {
      for (const subKey of Object.keys(value)) sources[`${prefix}${rawKey}.${subKey}`] = label;
    } else {
      sources[`${prefix}${rawKey}`] = label;
    }
  }
  return result;
}

function parseJson(raw, label) {
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) throw new Error("not a JSON object");
    return parsed;
  } catch (error) {
    throw new ConfigResolveError(`Rules from ${label} are not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
}

function isPathSpec(spec) {
  return /^(\.{1,2}[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(spec) || spec.endsWith(".json");
}

async function loadRemote(spec, { cacheDir, fetchImpl }) {
  // "https://host/rules.json#sha256=<hex>" pins the exact content.
  const [url, fragment = ""] = spec.split("#");
  const pin = fragment.match(/^sha256=([a-f0-9]{64})$/i)?.[1]?.toLowerCase();
  const cachePath = path.join(cacheDir, `${createHash("sha256").update(url).digest("hex")}.json`);

  const readCache = async () => {
    try {
      return { raw: await readFile(cachePath, "utf8"), age: Date.now() - (await stat(cachePath)).mtimeMs };
    } catch {
      return null;
    }
  };

  const verify = (raw) => {
    if (pin && createHash("sha256").update(raw).digest("hex") !== pin) {
      throw new ConfigResolveError(`Rules at ${url} do not match the pinned sha256; refusing to use them.`);
    }
    return raw;
  };

  const cached = await readCache();
  if (cached && (pin || cached.age < REMOTE_TTL_MS)) {
    try {
      return verify(cached.raw);
    } catch {
      // Stale or tampered cache: fall through to a fresh download.
    }
  }

  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = verify(await response.text());
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, raw, "utf8");
    return raw;
  } catch (error) {
    if (error instanceof ConfigResolveError) throw error;
    if (cached) return verify(cached.raw); // offline: last good copy
    throw new ConfigResolveError(`Could not download rules from ${url}: ${error instanceof Error ? error.message : error}`);
  }
}

function resolvePackage(spec, baseDir) {
  const require = createRequire(path.join(baseDir, "package.json"));
  for (const candidate of [`${spec}/gitsmith.json`, spec]) {
    try {
      const resolved = require.resolve(candidate);
      if (resolved.endsWith(".json")) return resolved;
    } catch {
      // try the next form
    }
  }
  throw new ConfigResolveError(
    `Could not find rules package "${spec}". Install it (npm i -D ${spec}) and make sure it ships gitsmith.json or a JSON main file.`
  );
}

/**
 * Loads one `extends` entry. Returns its JSON, a label for --resolved, and the
 * folder its own relative `extends` resolve against.
 */
async function loadSpec(spec, baseDir, options) {
  if (typeof spec !== "string" || spec.trim() === "") {
    throw new ConfigResolveError(`"extends" entries must be non-empty strings.`);
  }

  if (spec.startsWith(PRESET_PREFIX)) {
    const name = spec.slice(PRESET_PREFIX.length);
    const preset = PRESETS[name];
    if (!preset) {
      throw new ConfigResolveError(`Unknown preset "${spec}". Built-in presets: ${Object.keys(PRESETS).map((n) => PRESET_PREFIX + n).join(", ")}.`);
    }
    return { json: structuredClone(preset), label: spec, baseDir, key: spec };
  }

  if (/^https?:\/\//i.test(spec)) {
    const raw = await loadRemote(spec, options);
    return { json: parseJson(raw, spec), label: spec.split("#")[0], baseDir, key: spec };
  }

  const filePath = isPathSpec(spec) ? path.resolve(baseDir, spec) : resolvePackage(spec, baseDir);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new ConfigResolveError(`Could not read rules file ${filePath} (from "extends": "${spec}").`);
  }
  return { json: parseJson(raw, filePath), label: (path.relative(options.rootDir, filePath) || filePath).split(path.sep).join("/"), baseDir: path.dirname(filePath), key: filePath };
}

/**
 * Resolves one layer and everything it extends, depth first, in listed order.
 * Returns the merged rules, which label last set each key, and the order layers applied.
 */
async function resolveChain(json, label, baseDir, options, depth = 0, seen = new Set()) {
  if (depth > MAX_DEPTH) {
    throw new ConfigResolveError(`"extends" goes more than ${MAX_DEPTH} levels deep.`);
  }

  let merged = {};
  let sources = {};
  const chain = [];
  const parents = json.extends === undefined ? [] : Array.isArray(json.extends) ? json.extends : [json.extends];

  for (const spec of parents) {
    const loaded = await loadSpec(spec, baseDir, options);
    if (seen.has(loaded.key)) {
      throw new ConfigResolveError(`"extends" loops back to ${loaded.label}.`);
    }
    const parent = await resolveChain(loaded.json, loaded.label, loaded.baseDir, options, depth + 1, new Set([...seen, loaded.key]));
    // Parent values keep the labels the parent chain recorded.
    merged = mergeConfigs(merged, parent.merged, loaded.label, {});
    sources = { ...sources, ...parent.sources };
    chain.push(...parent.chain);
  }

  merged = mergeConfigs(merged, json, label, sources);
  chain.push(label);
  return { merged, sources, chain };
}

/**
 * Resolves a config's `extends` chain into one merged config.
 * Order: presets/files/URLs/packages in the order listed (recursively), then the
 * project file, then the personal local file (ai settings only).
 * @param {object} json the project .commitconfig.json content
 * @param {{configPath: string, localJson?: object | null, cacheDir?: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<{config: object, sources: Record<string, string>, chain: string[], warnings: string[]}>}
 */
export async function resolveConfig(json, options) {
  const rootDir = path.dirname(options.configPath);
  const resolveOptions = {
    rootDir,
    cacheDir: options.cacheDir ?? path.join(os.homedir(), ".gitsmith", "cache"),
    fetchImpl: options.fetchImpl ?? fetch
  };

  const projectLabel = path.basename(options.configPath);
  const { merged, sources, chain } = await resolveChain(json, projectLabel, rootDir, resolveOptions);

  let config = merged;
  const warnings = [];
  if (options.localJson) {
    const { ai, ...rest } = options.localJson;
    const ignored = Object.keys(rest).filter((key) => key !== "$schema");
    if (ignored.length > 0) {
      warnings.push(`.commitconfig.local.json can only change ai settings; ignored: ${ignored.join(", ")}.`);
    }
    if (isPlainObject(ai)) {
      const allowed = Object.fromEntries(Object.entries(ai).filter(([key]) => LOCAL_ALLOWED_AI_KEYS.includes(key)));
      const blocked = Object.keys(ai).filter((key) => !LOCAL_ALLOWED_AI_KEYS.includes(key));
      if (blocked.length > 0) {
        warnings.push(`.commitconfig.local.json cannot change ai.${blocked.join(", ai.")}; ignored.`);
      }
      config = mergeConfigs(config, { ai: allowed }, ".commitconfig.local.json", sources);
    }
  }

  return { config, sources, chain, warnings };
}
