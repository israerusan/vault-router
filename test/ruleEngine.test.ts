import assert from "node:assert";
import {
  findRoute,
  matchRule,
  normalizeFolder,
  renderDestination,
  renderTemplate,
} from "../src/core/routing/ruleEngine";
import { normalizeRules } from "../src/core/routing/normalizeRules";
import type { CandidateNote, RoutingRule } from "../src/types";

const note: CandidateNote = {
  path: "Inbox/alpha meeting.md",
  basename: "alpha meeting",
  filename: "alpha meeting.md",
  extension: "md",
  tags: ["meeting", "project"],
  frontmatter: {
    project: "Alpha",
    type: "meeting",
  },
};

const rule: RoutingRule = {
  id: "1",
  name: "meeting",
  enabled: true,
  titleStartsWith: "alpha",
  pathIncludes: "Inbox",
  requiredTag: "meeting",
  propertyKey: "project",
  propertyValue: "alpha",
  destinationFolder: "Meetings/{{frontmatter:project}}",
};

assert.ok(matchRule(rule, note), "rule should match title/path/tag/frontmatter");
assert.equal(renderTemplate(rule.destinationFolder, note), "Meetings/Alpha");
assert.equal(normalizeFolder("Projects\\\\Alpha//Notes"), "Projects/Alpha/Notes");

const routed = findRoute([rule], note, false);
assert.ok(routed, "route should resolve");
assert.equal(routed?.destinationPath, "Meetings/Alpha/alpha meeting.md");

// Free counts only ACTIVE rules toward the cap: five enabled non-matching rules
// followed by a sixth enabled matching rule -> the sixth is beyond the free cap.
const nonMatching = { ...rule, requiredTag: "does-not-exist" };
const sixEnabled = [
  { ...nonMatching, id: "e1" },
  { ...nonMatching, id: "e2" },
  { ...nonMatching, id: "e3" },
  { ...nonMatching, id: "e4" },
  { ...nonMatching, id: "e5" },
  { ...rule, id: "pro-match" },
];
assert.equal(findRoute(sixEnabled, note, false), null, "free ignores the 6th active rule");
assert.equal(findRoute(sixEnabled, note, true)?.rule.id, "pro-match", "pro evaluates all active rules");

// Disabled rules do NOT consume a free slot: four disabled + two enabled means
// both enabled rules are still within the free cap and evaluated.
const disabledDontCount = [
  { ...nonMatching, id: "d1", enabled: false },
  { ...nonMatching, id: "d2", enabled: false },
  { ...nonMatching, id: "d3", enabled: false },
  { ...nonMatching, id: "d4", enabled: false },
  { ...nonMatching, id: "e1" },
  { ...rule, id: "late-match" },
];
assert.equal(
  findRoute(disabledDontCount, note, false)?.rule.id,
  "late-match",
  "disabled rules should not consume free-cap slots"
);

const propertyExistsRule: RoutingRule = {
  ...rule,
  propertyValue: "",
  titleStartsWith: "",
  requiredTag: "",
  pathIncludes: "",
  destinationFolder: "Projects/{{frontmatter:project}}",
};
assert.ok(matchRule(propertyExistsRule, note), "property-only existence rule should match");

const missingValue = findRoute([
  {
    ...rule,
    propertyKey: "missing",
    propertyValue: "",
  },
], note, true);
assert.equal(missingValue, null, "missing required property should fail");

// --- Inherited property names must NOT match: a rule keyed on an Object.proto
// member (toString, constructor, __proto__) would otherwise "exist" for every
// note and mass-mis-file the inbox. Treat such a key as absent. ---
const protoRule: RoutingRule = {
  ...rule,
  titleStartsWith: "",
  requiredTag: "",
  pathIncludes: "",
  propertyKey: "toString",
  propertyValue: "",
};
assert.ok(!matchRule(protoRule, note), "an inherited property name must not count as present");
assert.equal(
  renderTemplate("{{frontmatter:toString}}", note),
  "",
  "an inherited property name renders empty, not the prototype function"
);

// --- Over-long segments are length-bounded so createFolder/renameFile can't
// throw on a path that exceeds the OS per-segment / total limit. ---
const longValue = "x".repeat(400);
const longSegment = renderTemplate("{{frontmatter:project}}", { ...note, frontmatter: { project: longValue } });
assert.ok(longSegment.length <= 120, `rendered segment must be length-bounded, got ${longSegment.length}`);

// --- Path-traversal security: a hostile frontmatter value must not escape ---
const evilNote: CandidateNote = {
  ...note,
  frontmatter: { project: "../../secret" },
};
const evilRoute = findRoute(
  [{ ...rule, titleStartsWith: "", requiredTag: "", pathIncludes: "", propertyKey: "", propertyValue: "", destinationFolder: "Projects/{{frontmatter:project}}" }],
  evilNote,
  true
);
assert.ok(evilRoute, "rule still matches");
// No path segment may be a traversal segment (".."/"."), so the file can never
// climb above its literal prefix even though the raw value contained "../..".
const evilSegments = (evilRoute?.destinationFolder ?? "").split("/");
assert.ok(
  !evilSegments.includes("..") && !evilSegments.includes("."),
  `destination must not contain a traversal segment, got ${evilRoute?.destinationPath}`
);
assert.ok(
  evilRoute?.destinationFolder.startsWith("Projects/"),
  "destination must stay under its literal prefix"
);

// A separator inside one token must not inject extra path segments.
assert.equal(renderTemplate("{{frontmatter:project}}", { ...note, frontmatter: { project: "a/b" } }), "a-b");

// Literal ".." in a template is dropped by normalizeFolder.
assert.equal(normalizeFolder("Projects/../Foo"), "Projects/Foo");

// Windows reserved names are neutralized.
assert.equal(renderTemplate("{{frontmatter:project}}", { ...note, frontmatter: { project: "CON" } }), "_CON");

// --- Empty token skips the rule instead of collapsing the folder ---
assert.equal(
  renderDestination("Meetings/{{frontmatter:project}}", { ...note, frontmatter: {} }),
  null,
  "empty token yields null so the rule is skipped"
);
const collapseRule: RoutingRule = {
  ...rule,
  titleStartsWith: "",
  requiredTag: "",
  pathIncludes: "",
  propertyKey: "",
  propertyValue: "",
  destinationFolder: "Meetings/{{frontmatter:project}}",
};
assert.equal(findRoute([collapseRule], { ...note, frontmatter: {} }, true), null, "missing token skips the rule");

// --- Array-valued frontmatter: exists + equals both work ---
const listNote: CandidateNote = { ...note, tags: [], frontmatter: { project: ["Alpha", "Beta"] } };
assert.ok(
  matchRule({ ...rule, titleStartsWith: "", requiredTag: "", pathIncludes: "", propertyKey: "project", propertyValue: "beta" }, listNote),
  "equals should match any array element"
);
assert.ok(
  matchRule({ ...rule, titleStartsWith: "", requiredTag: "", pathIncludes: "", propertyKey: "project", propertyValue: "" }, listNote),
  "exists should match a non-empty array"
);
assert.ok(
  !matchRule({ ...rule, titleStartsWith: "", requiredTag: "", pathIncludes: "", propertyKey: "project", propertyValue: "" }, { ...note, tags: [], frontmatter: { project: [] } }),
  "exists should treat an empty array as absent"
);

// A note matched via a LATER array element is filed under THAT element, not the
// first: destination rendering agrees with the equality match instead of always
// using value[0].
const listMatchRoute = findRoute(
  [{ ...rule, titleStartsWith: "", requiredTag: "", pathIncludes: "", propertyKey: "project", propertyValue: "beta", destinationFolder: "Meetings/{{frontmatter:project}}" }],
  { ...note, tags: [], frontmatter: { project: ["Alpha", "Beta"] } },
  true
);
assert.equal(
  listMatchRoute?.destinationFolder,
  "Meetings/Beta",
  "destination renders the matched array element, not the first"
);

// --- normalizeRules: untrusted data.json must never crash the engine/UI ---
// Malformed elements are dropped; the rest are repaired to safe defaults.
const cleaned = normalizeRules([null, 42, "nope", { name: "x", enabled: true }]);
assert.equal(cleaned.length, 1, "non-object rule elements are dropped");
const repaired = cleaned[0];
assert.equal(repaired.destinationFolder, "", "missing string fields default to empty string");
assert.equal(repaired.titleStartsWith, "", "missing fields are safe to .trim()");
assert.equal(repaired.enabled, true, "enabled defaults to true");
assert.ok(repaired.id, "a missing id is backfilled");
// A partial-but-enabled rule must be usable by matchRule/findRoute without throwing.
assert.doesNotThrow(() => matchRule(repaired, note), "repaired rule is safe for matchRule");
assert.equal(findRoute(cleaned, note, true), null, "a rule with no destination simply doesn't route");
// Non-array input yields an empty list rather than throwing.
assert.deepEqual(normalizeRules("garbage"), []);
assert.deepEqual(normalizeRules(undefined), []);

// --- Unicode: NFD note title must match an NFC rule (macOS decomposed names) ---
const nfcCafe = "Café";        // é as one code point
const nfdCafe = "Café";       // e + combining acute
assert.ok(
  matchRule(
    { ...rule, titleStartsWith: nfcCafe, pathIncludes: "", requiredTag: "", propertyKey: "", propertyValue: "" },
    { ...note, basename: `${nfdCafe} notes` }
  ),
  "an NFC rule should match an NFD note title"
);

// Zero-width characters are stripped from rendered destination segments.
assert.equal(
  renderTemplate("{{frontmatter:project}}", { ...note, frontmatter: { project: "al​pha" } }),
  "alpha",
  "zero-width space is stripped from a destination segment"
);
