// Built-in rule sets a config can extend with "gitsmith:<name>".
// They hold rules only (no "ai" block), so they are safe to share and combine.

export const PRESETS = {
  conventional: {
    types: ["feat", "fix", "docs", "chore", "refactor", "test", "style"],
    askScope: true,
    scopes: ["auth", "ui", "api", "db", "config"],
    askTicket: false,
    askBreaking: true,
    format: "{type}({scope}): {message}",
    headerMaxLength: 72,
    strictScopes: true,
    messageStyle: "conventional"
  },
  // Angular's commit guidelines: scopes are free-form, so none are listed.
  angular: {
    types: ["build", "ci", "docs", "feat", "fix", "perf", "refactor", "style", "test"],
    askScope: true,
    askTicket: false,
    askBreaking: true,
    format: "{type}({scope}){breaking}: {message}",
    headerMaxLength: 100,
    strictScopes: false,
    messageStyle: "conventional"
  },
  // Type and summary only, for small projects.
  minimal: {
    types: ["feat", "fix", "docs", "chore", "refactor", "test"],
    askScope: false,
    askTicket: false,
    askBreaking: true,
    format: "{type}{breaking}: {message}",
    headerMaxLength: 72,
    messageStyle: "conventional"
  }
};

export const PRESET_PREFIX = "gitsmith:";
