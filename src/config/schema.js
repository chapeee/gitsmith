import { z } from "zod";

// Tokens supported by the format engine (e.g. "{type}({scope}): {message}").
const formatTokenRegex = /\{(type|scope|ticket|message|breaking)\}/g;
const allowedTokens = new Set(["type", "scope", "ticket", "message", "breaking"]);
const aiSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.literal("nvidia").optional(),
    model: z.string().min(1, "ai.model cannot be empty").optional(),
    endpoint: z.string().url("ai.endpoint must be a valid URL").optional(),
    askByDefault: z.boolean().optional(),
    allowNewScopes: z.boolean().optional(),
    maxContextFileLines: z.number().int().positive().optional(),
    maxContextTotalLines: z.number().int().positive().optional(),
    mentionSuggestionLimit: z.number().int().positive().optional()
  })
  .optional();

// Base schema plus cross-field validation rules.
const baseSchema = z
  .object({
    types: z.array(z.string().min(1, "types entries cannot be empty")).min(1, "types must include at least one value"),
    askScope: z.boolean(),
    scopes: z.array(z.string().min(1, "scope values cannot be empty")).optional(),
    askTicket: z.boolean(),
    ticketPrefix: z.string().optional(),
    askBreaking: z.boolean(),
    format: z.string().min(1, "format is required"),
    headerMaxLength: z.number().int().positive().optional(),
    ai: aiSchema
  })
  .superRefine((config, ctx) => {
    if (config.askScope && Array.isArray(config.scopes) && config.scopes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scopes"],
        message: "scopes cannot be an empty array when askScope is true"
      });
    }

    if (!config.askTicket && config.ticketPrefix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ticketPrefix"],
        message: "ticketPrefix is only valid when askTicket is true"
      });
    }

    // Extract token usage to validate config/format consistency.
    const tokens = [...config.format.matchAll(formatTokenRegex)].map((match) => match[1]);
    const foundTokens = new Set(tokens);
    const invalidTokenMatches = config.format.match(/\{([^}]+)\}/g) ?? [];

    for (const tokenMatch of invalidTokenMatches) {
      const token = tokenMatch.slice(1, -1);
      if (!allowedTokens.has(token)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["format"],
          message: `Unsupported token "${tokenMatch}" in format`
        });
      }
    }

    if (!foundTokens.has("type") || !foundTokens.has("message")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["format"],
        message: "format must include {type} and {message}"
      });
    }

    if (foundTokens.has("scope") && !config.askScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["format"],
        message: "format includes {scope}, but askScope is false"
      });
    }

    if (foundTokens.has("ticket") && !config.askTicket) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["format"],
        message: "format includes {ticket}, but askTicket is false"
      });
    }
  });

export function validateConfig(config) {
  // safeParse lets us return a single aggregated, human-readable error message.
  const parsed = baseSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid .commitconfig.json:\n${details}`);
  }
  return parsed.data;
}
