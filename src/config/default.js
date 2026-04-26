// Canonical config filename discovered from the current directory upward.
export const CONFIG_FILE_NAME = ".commitconfig.json";

// Sensible out-of-the-box setup based on standard conventional commits.
export const defaultConfig = {
  types: ["feat", "fix", "docs", "chore", "refactor", "test", "style"],
  askScope: true,
  scopes: ["auth", "ui", "api", "db", "config"],
  askTicket: false,
  askBreaking: true,
  format: "{type}({scope}): {message}",
  headerMaxLength: 72,
  ai: {
    enabled: true,
    askByDefault: true
  }
};
