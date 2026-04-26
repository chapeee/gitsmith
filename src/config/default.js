export const CONFIG_FILE_NAME = ".commitconfig.json";

export const defaultConfig = {
  types: ["feat", "fix", "docs", "chore", "refactor", "test", "style"],
  askScope: true,
  scopes: ["auth", "ui", "api", "db", "config"],
  askTicket: false,
  askBreaking: true,
  format: "{type}({scope}): {message}",
  headerMaxLength: 72
};
