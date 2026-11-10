import { buildCommitMessage } from "../format/template.js";

// Messages git or other tools generate on their own; never block these.
const PASSTHROUGH_PATTERNS = [/^Merge /, /^Revert "/, /^(fixup|squash|amend)! /, /^Initial commit$/i];

const TOKEN_PATTERNS = {
  type: "(?<type>[A-Za-z0-9_-]+)",
  scope: "(?<scope>[^()\\s]*)",
  ticket: "(?<ticket>[^\\s\\[\\]()]*)",
  breaking: "(?<breaking>!?)",
  message: "(?<message>.+?)"
};

// Optional tokens may be rendered without their surrounding brackets.
const OPTIONAL_WRAPPED = /([([])\{(scope|ticket)\}([)\]])/g;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turns a format template such as "{type}({scope}): {message}" into a regex
 * with named groups. Whitespace in the template matches any whitespace.
 * @param {string} format
 */
export function formatToRegex(format) {
  let source = "";
  let lastIndex = 0;
  const pieces = [];

  for (const match of format.matchAll(OPTIONAL_WRAPPED)) {
    pieces.push({ literal: format.slice(lastIndex, match.index) });
    pieces.push({ optionalWrapped: match[2], open: match[1], close: match[3] });
    lastIndex = match.index + match[0].length;
  }
  pieces.push({ literal: format.slice(lastIndex) });

  for (const piece of pieces) {
    if (piece.optionalWrapped) {
      source += `(?:${escapeRegex(piece.open)}${TOKEN_PATTERNS[piece.optionalWrapped]}${escapeRegex(piece.close)})?`;
      continue;
    }
    const parts = piece.literal.split(/(\{(?:type|scope|ticket|message|breaking)\})/);
    for (const part of parts) {
      const token = part.match(/^\{(\w+)\}$/)?.[1];
      if (token) {
        source += TOKEN_PATTERNS[token];
      } else if (part) {
        source += escapeRegex(part).replace(/\s+/g, "\\s*");
      }
    }
  }

  return new RegExp(`^${source}$`);
}

/**
 * Extracts the header from a raw commit message (as written to COMMIT_EDITMSG):
 * drops git comment lines and returns the first non-empty line plus the body.
 * @param {string} raw
 */
export function splitCommitMessage(raw) {
  const lines = String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  // Everything below git's scissors line is the diff shown by `commit -v`.
  const scissors = lines.findIndex((line) => /^# -+ >8 -+/.test(line));
  const kept = (scissors === -1 ? lines : lines.slice(0, scissors)).filter((line) => !line.startsWith("#"));

  const headerIndex = kept.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1) {
    return { header: "", body: "", blankAfterHeader: true };
  }
  const next = kept[headerIndex + 1];
  return {
    header: kept[headerIndex].trim(),
    body: kept.slice(headerIndex + 1).join("\n").trim(),
    blankAfterHeader: next === undefined || next.trim() === ""
  };
}

/**
 * Conventional summary style: starts lowercase and has no trailing period.
 * Acronyms are allowed at the start ("API ..."), and messageStyle "off" disables the check.
 * @param {string} message
 * @param {object} config
 * @returns {string[]}
 */
export function messageStyleErrors(message, config) {
  if (config.messageStyle === "off") {
    return [];
  }
  const text = String(message ?? "").trim();
  const errors = [];
  if (/^[A-Z][a-z]/.test(text)) {
    errors.push(`message must start with a lowercase letter: "${text[0].toLowerCase()}${text.slice(1)}".`);
  }
  if (/\.$/.test(text)) {
    errors.push("message must not end with a period.");
  }
  return errors;
}

function normalizeTicket(ticket, config) {
  const value = String(ticket ?? "").trim();
  const prefix = config.ticketPrefix ?? "";
  if (!value || !prefix || value.startsWith(prefix)) {
    return value;
  }
  return `${prefix}${value}`;
}

/**
 * Checks commit parts against the project config.
 * Errors block the commit; warnings mirror the interactive flow, which only warns.
 * @param {{type?: string, scope?: string, ticket?: string, message?: string, breaking?: boolean}} parts
 * @param {object} config
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateParts(parts, config) {
  const errors = [];
  const warnings = [];

  const type = String(parts.type ?? "").trim();
  const scope = String(parts.scope ?? "").trim();
  const ticket = String(parts.ticket ?? "").trim();
  const message = String(parts.message ?? "").trim();

  if (!type) {
    errors.push(`type is required. Allowed: ${config.types.join(", ")}`);
  } else if (!config.types.includes(type)) {
    errors.push(`type "${type}" is not allowed. Allowed: ${config.types.join(", ")}`);
  }

  if (!config.askScope && scope) {
    errors.push("scope is not used in this project (askScope is false). Remove it.");
  }

  if (config.askScope && scope) {
    const scopes = Array.isArray(config.scopes) ? config.scopes : [];
    if (/[\s()]/.test(scope)) {
      errors.push(`scope "${scope}" cannot contain spaces or brackets.`);
    } else if (scopes.length > 0 && !scopes.includes(scope)) {
      const text = `scope "${scope}" is not in the list. Allowed: ${scopes.join(", ")}`;
      if (config.strictScopes) {
        errors.push(text);
      } else {
        warnings.push(text);
      }
    }
  }

  // The interactive flow always picks a scope when a list exists, so require one here too.
  const hasScopeList = Array.isArray(config.scopes) && config.scopes.length > 0;
  if (config.askScope && !scope && (hasScopeList || config.strictScopes)) {
    errors.push(`scope is required. Allowed: ${(config.scopes ?? []).join(", ")}`);
  }

  if (!config.askTicket && ticket) {
    errors.push("ticket is not used in this project (askTicket is false). Remove it.");
  }

  if (config.askTicket && ticket && config.ticketPrefix && !ticket.startsWith(config.ticketPrefix)) {
    errors.push(`ticket "${ticket}" must start with "${config.ticketPrefix}".`);
  }

  if (!message) {
    errors.push("message cannot be empty.");
  } else {
    errors.push(...messageStyleErrors(message, config));
  }

  if (parts.breaking && !config.askBreaking) {
    errors.push("breaking changes are not used in this project (askBreaking is false).");
  }

  return { errors, warnings };
}

function headerLengthWarning(header, config) {
  const limit = config.headerMaxLength;
  if (limit && header.length > limit) {
    return `header is ${header.length} characters (limit: ${limit}).`;
  }
  return null;
}

/**
 * Builds a header from parts and validates it. Used by flags mode and the AI flow.
 * @param {{type?: string, scope?: string, ticket?: string, message?: string, breaking?: boolean}} input
 * @param {object} config
 */
export function buildAndValidate(input, config) {
  const parts = {
    type: String(input.type ?? "").trim(),
    scope: String(input.scope ?? "").trim(),
    ticket: normalizeTicket(input.ticket, config),
    message: String(input.message ?? "").trim(),
    breaking: Boolean(input.breaking)
  };

  const { errors, warnings } = validateParts(parts, config);
  const header = buildCommitMessage(config.format, parts);

  const lengthWarning = headerLengthWarning(header, config);
  if (lengthWarning) {
    warnings.push(lengthWarning);
  }

  return { ok: errors.length === 0, header, parts, errors, warnings };
}

/**
 * Validates a full commit message (header and optional body) against the config.
 * @param {string} raw
 * @param {object} config
 */
export function checkCommitMessage(raw, config) {
  const { header, body, blankAfterHeader } = splitCommitMessage(raw);

  if (!header) {
    return { ok: false, skipped: false, header, body, parts: null, errors: ["commit message is empty."], warnings: [] };
  }

  if (PASSTHROUGH_PATTERNS.some((pattern) => pattern.test(header))) {
    return { ok: true, skipped: true, header, body, parts: null, errors: [], warnings: [] };
  }

  const match = header.match(formatToRegex(config.format));
  if (!match) {
    return {
      ok: false,
      skipped: false,
      header,
      body,
      parts: null,
      errors: [`header does not match the format "${config.format}".`],
      warnings: []
    };
  }

  const groups = match.groups ?? {};
  const parts = {
    type: groups.type ?? "",
    scope: groups.scope ?? "",
    ticket: groups.ticket ?? "",
    message: groups.message ?? "",
    breaking: groups.breaking === "!"
  };

  const { errors, warnings } = validateParts(parts, config);
  const lengthWarning = headerLengthWarning(header, config);
  if (lengthWarning) {
    warnings.push(lengthWarning);
  }

  if (body && !blankAfterHeader) {
    warnings.push("leave a blank line between the header and the body.");
  }

  return { ok: errors.length === 0, skipped: false, header, body, parts, errors, warnings };
}

/**
 * Builds a valid example header for the current config, used in hints.
 * @param {object} config
 */
export function exampleHeader(config) {
  return buildCommitMessage(config.format, {
    type: config.types[0],
    scope: config.askScope ? (config.scopes?.[0] ?? "core") : "",
    ticket: config.askTicket ? `${config.ticketPrefix ?? ""}123` : "",
    message: "add short summary in imperative mood",
    breaking: false
  });
}
