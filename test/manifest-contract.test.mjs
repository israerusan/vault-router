import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));

for (const key of ["name", "description", "id"]) {
  for (const word of ["obsidian", "plugin"]) {
    assert.ok(!new RegExp(word, "i").test(manifest[key]), `manifest.${key} must not contain ${word}`);
  }
}

assert.ok(/^[a-z0-9-]+$/.test(manifest.id), "manifest.id must be lowercase letters/digits/hyphens");
assert.ok(manifest.minAppVersion && /^\d+\.\d+\.\d+$/.test(manifest.minAppVersion), "manifest.minAppVersion must be x.y.z");
assert.ok(manifest.author, "manifest.author must be set");

// --- Portfolio identity: one author string across every plugin, so the community
// --- directory shows a single developer instead of several. Change CANONICAL_AUTHOR
// --- in every repo at once if it ever needs to change.
const CANONICAL_AUTHOR = "Israel Avila";
assert.equal(manifest.author, CANONICAL_AUTHOR, `manifest.author must be "${CANONICAL_AUTHOR}" across the whole portfolio`);

// --- Description policy (Obsidian community directory submission requirements).
// --- The directory card truncates long descriptions, so keep them short and benefit-first.
assert.ok(manifest.description.length <= 250, `manifest.description must be <= 250 chars (is ${manifest.description.length})`);
assert.ok(manifest.description.trim().endsWith("."), "manifest.description must end with a period");
assert.ok([...manifest.description].every((ch) => ch.codePointAt(0) < 128), "manifest.description must be ascii only (no emoji)");
assert.equal(typeof manifest.isDesktopOnly, "boolean", "manifest.isDesktopOnly must be boolean");
assert.ok(/^\d+\.\d+\.\d+$/.test(manifest.version), "manifest.version must be x.y.z");
assert.equal(manifest.version, pkg.version, "manifest and package versions must match");
assert.ok(versions[manifest.version], `versions.json must contain ${manifest.version}`);

console.log("ok  manifest-contract.test.mjs");
