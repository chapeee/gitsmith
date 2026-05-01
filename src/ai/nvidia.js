const SYSTEM_PROMPT = `You are a senior engineer that writes Conventional Commits messages. Read what the developer just did and return a single JSON object describing the commit. Be precise, calm, professional. No fluff.

You will be given the developer's .commitconfig.json values verbatim. Treat them as hard constraints.

RULES
1. "type" must be exactly one value from the provided "types" array. Pick the most accurate one based on what the developer actually did.
2. If "askScope" is true, pick exactly one "scope". Prefer values from the provided "scopes" array. If "allowNewScopes" is true and no allowed scope fits the change well, invent a new short lowercase scope (one word, no spaces, no punctuation) and set "scopeIsNew" to true. If "allowNewScopes" is false, you MUST pick from the provided scopes array, never invent. If "askScope" is false, return scope as null and scopeIsNew as false.
3. Write "message" in imperative present tense ("add", "fix", "remove", never "added", "fixes", "removing"). Lowercase first letter. No trailing period. Maximum 72 characters. Do not include the type or scope inside the message.
4. If "askBreaking" is true, set "isBreaking" to true only when the change clearly breaks public API or backward compatibility. Otherwise false. If "askBreaking" is false, return false.
5. If "askTicket" is true and the developer's description mentions a ticket id (like JIRA-123, #456, ABC-9), return it in "ticket". Otherwise return null.
6. Do NOT apply the "format" template yourself. Just return the parts. The CLI will format the final commit string.
7. Respond with ONLY a valid JSON object. No markdown fences, no commentary, no explanation, no extra keys.
8. When "Referenced files" are present, treat them as primary context. Extract concrete intent from them and combine with "What I did". Do not ignore file context.

OUTPUT SCHEMA
{
  "type": "<one of the configured types>",
  "scope": "<one of the configured scopes, or a new suggested scope if allowed, or null>",
  "scopeIsNew": <true|false>,
  "message": "<imperative sentence, max 72 chars>",
  "isBreaking": <true|false>,
  "ticket": "<ticket id string or null>",
  "reason": "<one short sentence, max 100 chars, why you picked this type and scope>"
}`;

export class AiNetworkError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "AiNetworkError";
    this.status = status;
  }
}

export class AiResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = "AiResponseError";
  }
}

export class AiValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "AiValidationError";
    this.field = field;
  }
}

function buildUserPrompt(config, description, fileContexts = []) {
  const filesSection =
    fileContexts.length > 0
      ? `\nReferenced files (read-only context, may be unchanged in this commit):\n${fileContexts
          .map(
            (file) =>
              `\n--- FILE: ${file.path} (${file.lineCount} lines) ---\n${String(file.content ?? "")}\n--- END FILE ---`
          )
          .join("\n")}`
      : "";

  return `types: ${JSON.stringify(config.types)}
scopes: ${JSON.stringify(config.scopes || [])}
askScope: ${config.askScope}, askTicket: ${config.askTicket}, askBreaking: ${config.askBreaking}, allowNewScopes: ${config.ai.allowNewScopes}
referencedFilesCount: ${fileContexts.length}

What I did: ${description}
${filesSection}

Return the JSON object only.`;
}

function stripJsonFence(text) {
  return String(text ?? "")
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function pickClosestScope(candidate, scopes) {
  const target = String(candidate ?? "").trim().toLowerCase();
  if (!target || !Array.isArray(scopes) || scopes.length === 0) {
    return null;
  }

  if (scopes.includes(target)) {
    return target;
  }

  const withScore = scopes.map((scope) => {
    const value = String(scope ?? "").toLowerCase();
    let score = 0;
    if (value.includes(target) || target.includes(value)) {
      score += 4;
    }
    for (const char of target) {
      if (value.includes(char)) {
        score += 1;
      }
    }
    return { scope: value, score };
  });

  withScore.sort((a, b) => b.score - a.score);
  return withScore[0]?.score > 0 ? withScore[0].scope : null;
}

function normalizeScopeResult(result, config) {
  const configuredScopes = Array.isArray(config.scopes) ? config.scopes : [];
  const scopeRaw = typeof result.scope === "string" ? result.scope.trim() : "";
  const knownScope = configuredScopes.includes(scopeRaw);

  if (knownScope) {
    result.scope = scopeRaw;
    result.scopeIsNew = false;
    return;
  }

  if (config.ai.allowNewScopes === true && scopeRaw) {
    const normalized = scopeRaw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalized) {
      result.scope = normalized;
      result.scopeIsNew = true;
      return;
    }
  }

  if (configuredScopes.length > 0) {
    const closest = pickClosestScope(scopeRaw, configuredScopes) ?? configuredScopes[0];
    result.scope = closest;
    result.scopeIsNew = false;
    return;
  }

  throw new AiValidationError("scope", "AI suggested an invalid scope.");
}

function validateSuggestion(result, config) {
  if (!config.types.includes(result.type)) {
    throw new AiValidationError("type", "AI suggested an invalid type.");
  }

  if (config.askScope) {
    normalizeScopeResult(result, config);
  } else if (result.scope !== null || result.scopeIsNew !== false) {
    throw new AiValidationError("scope", "AI suggested an invalid scope.");
  }

  if (typeof result.message !== "string" || result.message.trim().length === 0 || result.message.length > 72) {
    throw new AiValidationError("message", "AI suggested an invalid message.");
  }

  if (typeof result.isBreaking !== "boolean") {
    throw new AiValidationError("isBreaking", "AI suggested an invalid isBreaking value.");
  }

  if (!config.askBreaking && result.isBreaking !== false) {
    throw new AiValidationError("isBreaking", "AI suggested an invalid isBreaking value.");
  }

  if (result.ticket !== null && typeof result.ticket !== "string") {
    throw new AiValidationError("ticket", "AI suggested an invalid ticket.");
  }

  if (typeof result.reason !== "string" || result.reason.length > 100) {
    throw new AiValidationError("reason", "AI suggested an invalid reason.");
  }
}

export async function suggestCommit({ description, fileContexts = [], config, apiKey }) {
  const endpoint = config.ai.endpoint;
  const model = config.ai.model;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(config, description, fileContexts) }
        ],
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 220,
        stream: false
      })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network failure";
    throw new AiNetworkError(message);
  }

  if (!response.ok) {
    throw new AiNetworkError(`HTTP ${response.status}`, response.status);
  }

  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
  const content = stripJsonFence(rawContent);

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiResponseError("AI returned invalid response.");
  }

  validateSuggestion(parsed, config);
  return parsed;
}
