import type { RoutingRule } from "../../types";

// Loaded data.json is untrusted: it may be hand-edited, corrupt, or written by
// an older/newer schema. Every rule field is coerced to a safe value so the
// downstream engine (which calls `.trim()`, reads `.enabled`, etc.) and the
// settings tab can never crash on a malformed element. A non-object element is
// dropped entirely rather than repaired.

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function fallbackId(): string {
  return `r-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeRule(raw: unknown): RoutingRule | null {
  if (!raw || typeof raw !== "object") return null;
  const rule = raw as Record<string, unknown>;
  return {
    id: asString(rule.id) || fallbackId(),
    name: asString(rule.name) || "Untitled rule",
    enabled: asBool(rule.enabled, true),
    titleStartsWith: asString(rule.titleStartsWith),
    pathIncludes: asString(rule.pathIncludes),
    requiredTag: asString(rule.requiredTag),
    propertyKey: asString(rule.propertyKey),
    propertyValue: asString(rule.propertyValue),
    destinationFolder: asString(rule.destinationFolder),
  };
}

export function normalizeRules(raw: unknown): RoutingRule[] {
  if (!Array.isArray(raw)) return [];
  const out: RoutingRule[] = [];
  for (const item of raw) {
    const normalized = normalizeRule(item);
    if (normalized) out.push(normalized);
  }
  return out;
}
