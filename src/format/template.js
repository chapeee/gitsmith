function normalizeSpacing(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\(\s+\)/g, "()")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s+/g, "(")
    .replace(/\s+:/g, ":")
    .trim();
}

export function buildCommitMessage(format, values) {
  const tokens = {
    type: values.type ?? "",
    scope: values.scope ?? "",
    ticket: values.ticket ?? "",
    message: values.message ?? "",
    breaking: values.breaking ? "!" : ""
  };

  const rendered = format.replace(/\{(type|scope|ticket|message|breaking)\}/g, (_, token) => tokens[token] ?? "");
  return normalizeSpacing(rendered);
}
