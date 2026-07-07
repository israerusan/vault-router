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
    const actual = ownFrontmatter(note, rule.propertyKey.trim());
    if (rule.propertyValue.trim()) {
      if (!valueMatches(actual, rule.propertyValue.trim())) return false;
    } else if (!propertyPresent(actual)) {
      return false;
    }
  }

  return true;
}

// Read a frontmatter key as an OWN property only. Bare bracket access resolves
// inherited Object.prototype members (__proto__, toString, constructor, …),
// which are truthy for every note — a rule keyed on one of those names would
// otherwise "match" (and mass-mis-file) the whole inbox. Treat such a key as
// absent so matching/rendering is confined to real YAML keys.
function ownFrontmatter(note: CandidateNote, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(note.frontmatter, key)
    ? note.frontmatter[key]
    : undefined;
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
    const rendered = renderDestination(rule.destinationFolder, note, rule);
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
export function renderDestination(
  template: string,
  note: CandidateNote,
  rule?: RoutingRule
): string | null {
  let sawEmptyToken = false;
  const rendered = template.replace(TOKEN_PATTERN, (_, token) => {
    const segment = sanitizeSegment(resolveToken(String(token), note, rule));
    if (!segment) sawEmptyToken = true;
    return segment;
  });
  return sawEmptyToken ? null : rendered;
}

function resolveToken(token: string, note: CandidateNote, rule?: RoutingRule): string {
  const trimmed = token.trim();
  if (trimmed === "basename") return note.basename;
  if (trimmed === "filename") return note.filename;
  if (trimmed === "ext") return note.extension;
  const frontmatterMatch = /^frontmatter:(.+)$/i.exec(trimmed);
  if (frontmatterMatch) {
    const key = frontmatterMatch[1].trim();
    const value = ownFrontmatter(note, key);
    // matchRule matches a list-valued property if ANY element equals the wanted
    // value. When the destination renders that SAME key, file the note under the
    // element that actually satisfied the match — otherwise a note matched via a
    // later element (project: [alpha, beta], propertyValue "beta") would be filed
    // under the first element ("alpha"), a folder the rule never keyed on.
    if (rule && Array.isArray(value) && rule.propertyKey.trim() === key && rule.propertyValue.trim()) {
      return matchedArrayElement(value, rule.propertyValue.trim());
    }
    return scalarText(value);
  }
  return "";
}

// The array element whose folded text equals the wanted value; falls back to the
// first element (scalarText) if none is found, though matchRule guarantees a hit
// whenever this is reached.
function matchedArrayElement(value: unknown[], wanted: string): string {
  const target = fold(wanted);
  const hit = value.find((item) => fold(scalarText(item)) === target);
  return hit !== undefined ? scalarText(hit) : scalarText(value);
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
  let cleaned = value
    .replace(/[\\/]/g, "-")
    .replace(/[:*?"<>|]/g, "-")
    // Strip Unicode format characters (zero-width space/joiners, word joiner,
    // BOM) that \s doesn't cover — they'd create invisible-character folder
    // names that look identical to real ones.
    .replace(/\p{Cf}/gu, "")
    // Also drop C0/C1 control characters (null, etc.) that \s doesn't cover, so
    // hostile frontmatter can't embed an unprintable byte into a folder name.
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    // Trim BEFORE stripping leading dots: otherwise a value like " .config"
    // keeps its leading space, the anchored ^\.+ can't match, and the later
    // trim exposes the hidden ".config" the strip was meant to remove.
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  // Bound the segment length: a multi-hundred-char frontmatter value would
  // otherwise produce a folder name that blows past the per-segment (255) or
  // total path limit on Windows/mobile, making createFolder/renameFile throw.
  // Re-trim after slicing so a truncation can't leave a trailing dot/space
  // (which Windows rejects).
  if (cleaned.length > 120) {
    cleaned = cleaned.slice(0, 120).replace(/[. ]+$/, "");
  }
  if (!cleaned) return "";
  // On Windows a reserved device name is reserved even with an extension
  // ("CON.txt"), so test the base name before the first dot, not the whole
  // segment.
  const base = cleaned.split(".", 1)[0];
  return WINDOWS_RESERVED.test(base) ? `_${cleaned}` : cleaned;
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
