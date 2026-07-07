import { FREE_RULE_LIMIT } from "../../product";
import type { CandidateNote, RouteMatch, RoutingRule } from "../../types";

export function matchRule(rule: RoutingRule, note: CandidateNote): boolean {
  if (!rule.enabled) return false;
  if (!rule.destinationFolder.trim()) return false;

  if (rule.titleStartsWith.trim()) {
    if (!fold(note.basename).startsWith(fold(rule.titleStartsWith.trim()))) {
      return false;
    }
  }

  if (rule.pathIncludes.trim()) {
    if (!fold(note.path).includes(fold(rule.pathIncludes.trim()))) {
      return false;
    }
  }

  if (rule.requiredTag.trim()) {
    const wanted = normalizeTag(rule.requiredTag);
    const tags = note.tags.map(normalizeTag);
    if (!tags.includes(wanted)) return false;
  }

  if (rule.propertyKey.trim()) {
    const actual = note.frontmatter[rule.propertyKey.trim()];
    if (rule.propertyValue.trim()) {
      if (!valueMatches(actual, rule.propertyValue.trim())) return false;
    } else if (!propertyPresent(actual)) {
      return false;
    }
  }

  return true;
}

// A frontmatter property counts as "present" when the key holds a real value.
// An empty string or an empty array is treated as absent (nothing to route on).
function propertyPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some((item) => propertyPresent(item));
  return true;
}

// Equality match is array-aware: a list-valued property matches if ANY element
// equals the wanted value (e.g. tags-like `project: [alpha, beta]`).
function valueMatches(actual: unknown, wanted: string): boolean {
  const target = fold(wanted);
  if (Array.isArray(actual)) {
    return actual.some((item) => fold(scalarText(item)) === target);
  }
  return fold(scalarText(actual)) === target;
}

// Case- AND Unicode-insensitive fold. macOS stores filenames decomposed (NFD)
// while rule text typed in settings is usually composed (NFC); without an NFC
// pass, "Café" typed in a rule silently fails to match an NFD "Café" note.
function fold(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

export function findRoute(
  rules: RoutingRule[],
  note: CandidateNote,
  isPro: boolean
): RouteMatch | null {
  // The free cap is "up to N ACTIVE rules" (what the paywall sells), so disabled
  // rules don't consume a slot — filter to enabled rules first, then take the
  // first N. Otherwise a disabled rule in an early slot would silently push an
  // enabled rule past the cap.
  const activeRules = rules.filter((rule) => rule.enabled);
  const allowedRules = isPro ? activeRules : activeRules.slice(0, FREE_RULE_LIMIT);
  for (const rule of allowedRules) {
    if (!matchRule(rule, note)) continue;
    // If any template token resolves to empty (e.g. missing frontmatter), skip
    // the rule rather than silently collapsing the path to a shorter/wrong
    // folder. renderDestination returns null in that case.
    const rendered = renderDestination(rule.destinationFolder, note);
    if (rendered === null) continue;
    const destinationFolder = normalizeFolder(rendered);
    if (!destinationFolder) continue;
    return {
      rule,
      destinationFolder,
      destinationPath: joinPath(destinationFolder, note.filename),
    };
  }
  return null;
}

const TOKEN_PATTERN = /{{\s*([^}]+)\s*}}/g;

export function renderTemplate(template: string, note: CandidateNote): string {
  return template.replace(TOKEN_PATTERN, (_, token) => {
    const value = resolveToken(String(token), note);
    return sanitizeSegment(value);
  });
}

// Like renderTemplate, but returns null if the template contained at least one
// token that resolved to an empty segment. Callers use this to skip a rule
// instead of routing a note into a partially-collapsed destination.
export function renderDestination(template: string, note: CandidateNote): string | null {
  let sawEmptyToken = false;
  const rendered = template.replace(TOKEN_PATTERN, (_, token) => {
    const segment = sanitizeSegment(resolveToken(String(token), note));
    if (!segment) sawEmptyToken = true;
    return segment;
  });
  return sawEmptyToken ? null : rendered;
}

function resolveToken(token: string, note: CandidateNote): string {
  const trimmed = token.trim();
  if (trimmed === "basename") return note.basename;
  if (trimmed === "filename") return note.filename;
  if (trimmed === "ext") return note.extension;
  const frontmatterMatch = /^frontmatter:(.+)$/i.exec(trimmed);
  if (frontmatterMatch) {
    const key = frontmatterMatch[1].trim();
    const value = note.frontmatter[key];
    return scalarText(value);
  }
  return "";
}

function scalarText(value: unknown): string {
  if (Array.isArray(value)) return value.length ? scalarText(value[0]) : "";
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// A resolved token is ONE path segment and must never be able to inject
// separators or climb the tree. This strips path separators, illegal chars,
// leading dots (., .., hidden), and Windows trailing dots/spaces, and prefixes
// reserved device names — so hostile frontmatter like "../../secret" can't
// escape the destination parent (or the vault).
function sanitizeSegment(value: string): string {
  const cleaned = value
    .replace(/[\\/]/g, "-")
    .replace(/[:*?"<>|]/g, "-")
    // Strip Unicode format characters (zero-width space/joiners, word joiner,
    // BOM) that \s doesn't cover — they'd create invisible-character folder
    // names that look identical to real ones.
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (!cleaned) return "";
  return WINDOWS_RESERVED.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function normalizeFolder(path: string): string {
  return path
    .replace(/\\+/g, "/")
    .replace(/\/+/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    // Drop any "." / ".." segment so a literal template (or leftover input)
    // can never resolve above its own prefix.
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function joinPath(folder: string, file: string): string {
  return folder ? `${folder}/${file}` : file;
}

function normalizeTag(tag: string): string {
  return fold(tag.trim().replace(/^#/, ""));
}
