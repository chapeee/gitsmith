import { createHash } from "node:crypto";

// Safe, idempotent updates of the gitsmith-managed section in files people also
// edit by hand (AGENTS.md, CLAUDE.md, .cursorrules).
//
// Guarantees:
// - Everything outside the markers stays byte-for-byte identical.
// - Markers count only as whole lines outside fenced code blocks, so a file that
//   merely mentions them in prose or in an example is never cut open.
// - The start marker records a fingerprint of what gitsmith wrote. If the section
//   was edited since, the edit is kept unless the caller forces a replacement.
// - Broken marker layouts (one marker missing, wrong order, two sections) are
//   reported and the file is left alone.

export const SECTION_START = "<!-- gitsmith:start -->";
export const SECTION_END = "<!-- gitsmith:end -->";

const START_LINE = /^[ \t]*<!-- gitsmith:start(?:\s+hash=([a-f0-9]{12}))?\s*-->[ \t]*$/;
const END_LINE = /^[ \t]*<!-- gitsmith:end\s*-->[ \t]*$/;
const FENCE_LINE = /^[ \t]*(```|~~~)/;

export const SECTION_NOTE =
  "<!-- Managed by gitsmith (`gitsmith agents`). Keep your own notes outside these markers. If you edit inside, gitsmith keeps your version and stops updating this section until you run `gitsmith agents --force`. -->";

/**
 * Fingerprint of section content, ignoring line-ending style and outer whitespace.
 * @param {string} text
 */
export function sectionHash(text) {
  const normalized = String(text).replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

function detectEol(text) {
  return text && text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Finds marker lines with their character offsets, skipping fenced code blocks.
 * @param {string} text
 * @returns {{kind: "start" | "end", hash: string | null, lineStart: number, lineEnd: number, line: number}[]}
 */
export function findMarkers(text) {
  const markers = [];
  let inFence = false;
  let fenceToken = "";
  let offset = 0;
  let lineNumber = 0;

  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const lineEnd = newline === -1 ? text.length : newline + 1;
    const rawLine = text.slice(offset, newline === -1 ? text.length : newline).replace(/\r$/, "");
    lineNumber += 1;

    const fence = rawLine.match(FENCE_LINE);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceToken = fence[1];
      } else if (fence[1] === fenceToken) {
        inFence = false;
      }
    } else if (!inFence) {
      const start = rawLine.match(START_LINE);
      if (start) {
        markers.push({ kind: "start", hash: start[1] ?? null, lineStart: offset, lineEnd, line: lineNumber });
      } else if (END_LINE.test(rawLine)) {
        markers.push({ kind: "end", hash: null, lineStart: offset, lineEnd, line: lineNumber });
      }
    }

    if (newline === -1) break;
    offset = lineEnd;
  }
  return markers;
}

function buildBlock(section, eol) {
  const body = [SECTION_NOTE, ...String(section).replace(/\r\n/g, "\n").split("\n")].join("\n");
  const hash = sectionHash(body);
  return {
    hash,
    text: [`<!-- gitsmith:start hash=${hash} -->`, ...body.split("\n"), SECTION_END].join(eol)
  };
}

/**
 * Works out the new file content for a gitsmith section update. Never throws on
 * user content; problems come back as status "malformed" with an explanation.
 *
 * @param {string | null} existing current file content, or null when the file doesn't exist
 * @param {string} section the Markdown gitsmith wants inside the markers
 * @param {{force?: boolean}} [options] force replaces a section that was edited by hand
 * @returns {{status: "created" | "appended" | "updated" | "unchanged" | "kept-edits" | "malformed",
 *   content: string | null, message: string}}
 *   content is the full new file content, or null when nothing should be written.
 */
export function planSectionUpdate(existing, section, options = {}) {
  if (existing === null || existing.length === 0) {
    const { text } = buildBlock(section, "\n");
    return { status: "created", content: `${text}\n`, message: "created" };
  }

  const eol = detectEol(existing);
  const markers = findMarkers(existing);

  if (markers.length === 0) {
    const { text } = buildBlock(section, eol);
    // Keep the existing text exactly; only add the separation the block needs.
    const separator = existing.endsWith(`${eol}${eol}`) || existing.endsWith("\n\n")
      ? ""
      : existing.endsWith("\n")
        ? eol
        : `${eol}${eol}`;
    return { status: "appended", content: `${existing}${separator}${text}${eol}`, message: "added the gitsmith section at the end" };
  }

  const starts = markers.filter((marker) => marker.kind === "start");
  const ends = markers.filter((marker) => marker.kind === "end");
  const describe = (list) => list.map((marker) => `line ${marker.line}`).join(", ");

  if (starts.length !== 1 || ends.length !== 1 || ends[0].lineStart < starts[0].lineStart) {
    let problem;
    if (starts.length > 1 || ends.length > 1) {
      problem = `found more than one gitsmith section (start markers at ${describe(starts) || "none"}, end markers at ${describe(ends) || "none"})`;
    } else if (starts.length === 0) {
      problem = `found "${SECTION_END}" (${describe(ends)}) without "${SECTION_START}"`;
    } else if (ends.length === 0) {
      problem = `found "${SECTION_START}" (${describe(starts)}) without "${SECTION_END}"`;
    } else {
      problem = `"${SECTION_END}" (${describe(ends)}) comes before "${SECTION_START}" (${describe(starts)})`;
    }
    return {
      status: "malformed",
      content: null,
      message: `${problem}. Fix the markers by hand so there is exactly one start and one end marker (or remove both); the file was not changed.`
    };
  }

  const [start] = starts;
  const [end] = ends;
  const inner = existing.slice(start.lineEnd, end.lineStart);
  const next = buildBlock(section, eol);
  const nextInner = next.text.split(eol).slice(1, -1).join(eol);

  const currentHash = sectionHash(inner);
  const editedByHand = start.hash ? currentHash !== start.hash : currentHash !== sectionHash(nextInner);

  if (editedByHand && !options.force) {
    return {
      status: "kept-edits",
      content: null,
      message:
        "the gitsmith section was edited by hand, so your version was kept. Run with --force to replace it with the current rules, or --print to see them."
    };
  }

  if (!editedByHand && start.hash === next.hash) {
    return { status: "unchanged", content: null, message: "already up to date" };
  }

  // The end marker line may end without a newline at the end of the file; keep that.
  const endLine = existing.slice(end.lineStart, end.lineEnd);
  const trailingNewline = endLine.endsWith("\n") ? (endLine.endsWith("\r\n") ? "\r\n" : "\n") : "";
  const content = existing.slice(0, start.lineStart) + next.text + trailingNewline + existing.slice(end.lineEnd);
  return {
    status: "updated",
    content,
    message: editedByHand ? "replaced your edited section (--force)" : "updated the gitsmith section"
  };
}
