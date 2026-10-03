import type { InputBinding } from "@/lib/types";

function resolveDynamicToken(token: string): string {
  switch (token) {
    case "$string.uuid":
      return crypto.randomUUID();
    case "$date.now":
      return new Date().toISOString();
    case "$date.local": {
      const parts = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(new Date());
      const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
      return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
    }
    default:
      return `{{${token}}}`;
  }
}

function lookupVariable(token: string, variables: Record<string, unknown>) {
  if (Object.hasOwn(variables, token)) return variables[token];

  return token.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && Object.hasOwn(current, segment)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, variables);
}

function stringifyTemplateValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function resolveTemplateToken(token: string, variables: Record<string, unknown>) {
  if (/^\$[a-zA-Z0-9_.]+$/.test(token)) return resolveDynamicToken(token);
  return lookupVariable(token, variables);
}

function renderStringTemplate(text: string, variables: Record<string, unknown>) {
  return text.replace(/{{\s*([^{}]+?)\s*}}/g, (_, token: string) =>
    stringifyTemplateValue(resolveTemplateToken(token, variables)),
  );
}

function renderJsonTemplate(value: unknown, variables: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => renderJsonTemplate(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderJsonTemplate(item, variables)]),
    );
  }
  if (typeof value !== "string") return value;

  const exactToken = value.match(/^{{\s*([^{}]+?)\s*}}$/);
  if (exactToken) {
    const resolved = resolveTemplateToken(exactToken[1], variables);
    return resolved ?? "";
  }

  return renderStringTemplate(value, variables);
}

export function buildVariables(row: Record<string, unknown>, bindings: InputBinding[]) {
  const vars: Record<string, unknown> = {};
  for (const binding of bindings) {
    vars[binding.placeholder] = row[binding.column];
  }
  vars.input = row;
  return vars;
}

export function renderRequestTemplate(template: string, variables: Record<string, unknown>) {
  try {
    return renderJsonTemplate(JSON.parse(template), variables);
  } catch {
    // Fall through to string template mode for non-JSON request bodies.
  }

  const rendered = renderStringTemplate(template, variables);
  try {
    return JSON.parse(rendered);
  } catch {
    return rendered;
  }
}

export function renderHeaderTemplate(
  headerTemplate: Record<string, string>,
  variables: Record<string, unknown>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(headerTemplate)) {
    headers[key] = renderStringTemplate(String(value ?? ""), variables);
  }
  return headers;
}
