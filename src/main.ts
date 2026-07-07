import {
  Notice,
  Plugin,
  TFile,
  normalizePath,
  type CachedMetadata,
} from "obsidian";
import { LicenseManager } from "./core/license/LicenseManager";
import { normalizeRules } from "./core/routing/normalizeRules";
import { findRoute, normalizeFolder } from "./core/routing/ruleEngine";
import { FREE_BULK_LIMIT, FREE_RULE_LIMIT, PRODUCT_NAME } from "./product";
import { DEFAULT_SETTINGS, VaultRouterSettingTab } from "./settings";
import type { CandidateNote, LicenseState, VaultRouterSettings } from "./types";

// How a route was triggered — governs which notices fire. "manual" always
// confirms the outcome; "auto" respects the show-move-notice setting; "bulk"
// stays silent per-note because the sweep reports one summary at the end.
type RouteMode = "manual" | "auto" | "bulk";

export default class VaultRouterPlugin extends Plugin {
  settings: VaultRouterSettings = DEFAULT_SETTINGS;
  isPro = false;
  licenseEmail?: string;
  licenseError?: string;

  // Serializes every route so two async routes (e.g. an inbox sweep racing a
  // route-on-create timer) can't both resolve the same destination as "free"
  // and clobber each other (check-then-rename is not atomic).
  private routeChain: Promise<unknown> = Promise.resolve();

  // Paths of notes created this session that haven't been routed yet. Bounded by
  // how many new notes the user makes; entries clear once a note is moved.
  private readonly pendingCreated = new Set<string>();

  private enqueueRoute<T>(task: () => Promise<T>): Promise<T> {
    const run = this.routeChain.then(task, task);
    // Keep the chain alive regardless of outcome, and swallow rejections on the
    // internal chain so one failure can't reject every queued route after it.
    this.routeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.refreshLicense();
    // Persist any normalization refreshLicense applied (e.g. clearing a stale
    // Pro-only auto-route toggle when the license no longer validates).
    await this.saveSettings();

    this.addCommand({
      id: "route-current-note",
      name: "Route current note",
      callback: () => void this.routeCurrentNote(),
    });

    this.addCommand({
      id: "preview-route-current-note",
      name: "Preview route for current note",
      callback: () => void this.previewCurrentNote(),
    });

    this.addCommand({
      id: "route-inbox-now",
      name: "Route inbox now",
      callback: () => void this.routeInboxNow(),
    });

    this.addSettingTab(new VaultRouterSettingTab(this.app, this));

    // Register the create/index listeners only AFTER layout is ready. Obsidian
    // replays a "create" for every existing file during initial vault load, so
    // registering in onload directly would re-route the whole vault on launch.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (!(file instanceof TFile) || file.extension !== "md") return;
          // Only track new notes when auto-routing is actually active, so the
          // pending set can't grow across a session for Free / auto-off users.
          // We route them once their metadata is parsed (see "changed") rather
          // than guessing with a fixed timer while frontmatter/tags are empty.
          if (!this.settings.routeOnCreate || !this.isPro) return;
          this.pendingCreated.add(file.path);
        })
      );

      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (!this.settings.routeOnCreate || !this.isPro) return;
          if (!(file instanceof TFile)) return;
          if (!this.pendingCreated.has(file.path)) return;
          void this.routeCreatedFile(file);
        })
      );

      // Keep the pending set keyed to the live path: naming a brand-new note
      // renames Untitled.md -> the typed title, and we still want to route it.
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (!this.pendingCreated.delete(oldPath)) return;
          if (file instanceof TFile && file.extension === "md") {
            this.pendingCreated.add(file.path);
          }
        })
      );

      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          this.pendingCreated.delete(file.path);
        })
      );
    });
  }

  // Route a newly-created note now that its cache is available. Only drop it
  // from the pending set once it actually moves, so a note that isn't routable
  // yet (e.g. its matching frontmatter hasn't been typed) gets another chance
  // when it's next indexed.
  private async routeCreatedFile(file: TFile): Promise<void> {
    const result = await this.routeFile(file, "auto");
    if (result === "moved") this.pendingCreated.delete(file.path);
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown> | null;
    const data: Record<string, unknown> = raw && typeof raw === "object" ? raw : {};
    // structuredClone so we never hand out (and later mutate) DEFAULT_SETTINGS'
    // own arrays/objects. Each field is coerced by type — a whitelist rebuild,
    // which also means stray keys like __proto__ from a hand-edited data.json
    // are simply ignored rather than merged in.
    const defaults = clonePlain(DEFAULT_SETTINGS);
    const status = data.licenseStatus;
    this.settings = {
      inboxFolder: typeof data.inboxFolder === "string" ? data.inboxFolder : defaults.inboxFolder,
      routeOnCreate: typeof data.routeOnCreate === "boolean" ? data.routeOnCreate : defaults.routeOnCreate,
      autoRouteOnlyInbox:
        typeof data.autoRouteOnlyInbox === "boolean" ? data.autoRouteOnlyInbox : defaults.autoRouteOnlyInbox,
      showMoveNotice: typeof data.showMoveNotice === "boolean" ? data.showMoveNotice : defaults.showMoveNotice,
      licenseKey: typeof data.licenseKey === "string" ? data.licenseKey : defaults.licenseKey,
      licenseStatus: status === "valid-pro" || status === "invalid" ? status : "free",
      // Absent rules key -> seed the starter rules; present (even if empty or
      // partly corrupt) -> honor the user's data, dropping unusable elements.
      rules: Array.isArray(data.rules) ? normalizeRules(data.rules) : clonePlain(defaults.rules),
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  refreshLicense(): LicenseState {
    const key = this.settings.licenseKey?.trim();
    if (!key) {
      this.isPro = false;
      this.licenseEmail = undefined;
      this.licenseError = undefined;
      this.settings.licenseStatus = "free";
      return { isPro: false };
    }

    const result = LicenseManager.verify(key);
    this.isPro = result.valid;
    this.licenseEmail = result.valid ? result.email : undefined;
    this.licenseError = result.valid ? undefined : result.error;
    this.settings.licenseStatus = result.valid ? "valid-pro" : "invalid";
    // If Pro was lost (key removed/invalid), don't leave the Pro-only auto-route
    // toggle silently "on but doing nothing" — turn it off so on-screen state
    // matches actual behavior.
    if (!this.isPro && this.settings.routeOnCreate) {
      this.settings.routeOnCreate = false;
    }
    return { isPro: result.valid, email: result.email, error: result.error };
  }

  private getActiveMarkdownFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice(`${PRODUCT_NAME}: open a Markdown note first.`);
      return null;
    }
    return file;
  }

  private async previewCurrentNote(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) return;
    const message = this.describeRoute(file);
    new Notice(message, 6000);
  }

  private async routeCurrentNote(): Promise<void> {
    const file = this.getActiveMarkdownFile();
    if (!file) return;
    await this.routeFile(file, "manual");
  }

  private async routeInboxNow(): Promise<void> {
    const inboxFolder = normalizeFolder(this.settings.inboxFolder || "Inbox");
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${inboxFolder}/`));

    if (!files.length) {
      new Notice(`${PRODUCT_NAME}: no Markdown notes found in ${inboxFolder || "Inbox"}.`);
      return;
    }

    // Cap on MOVES, not on files scanned. Slicing the file list first would let
    // a large backlog whose early notes match nothing route zero notes; instead
    // we scan every inbox note and stop once we've actually moved the free limit.
    const moveLimit = this.isPro ? Infinity : FREE_BULK_LIMIT;
    let moved = 0;
    let skipped = 0;
    let failed = 0;
    let hitCap = false;

    for (const file of files) {
      if (moved >= moveLimit) {
        hitCap = true;
        break;
      }
      const result = await this.routeFile(file, "bulk");
      if (result === "moved") moved += 1;
      else if (result === "failed") failed += 1;
      else skipped += 1;
    }

    let summary = `${PRODUCT_NAME}: moved ${moved}, skipped ${skipped}`;
    summary += failed ? `, failed ${failed}.` : ".";
    if (hitCap) {
      summary += ` Free is capped at ${FREE_BULK_LIMIT} moves per sweep — run it again or upgrade to Pro for unlimited.`;
    }
    new Notice(summary, 7000);
  }

  private describeRoute(file: TFile): string {
    const candidate = this.toCandidate(file, this.app.metadataCache.getFileCache(file));
    const match = findRoute(this.settings.rules, candidate, this.isPro);
    const activeCount = this.settings.rules.filter((rule) => rule.enabled).length;
    const capApplies = !this.isPro && activeCount > FREE_RULE_LIMIT;
    const capHint = capApplies
      ? ` Free evaluates only your first ${FREE_RULE_LIMIT} active rules — upgrade to Pro to use the rest.`
      : "";
    if (!match) {
      return `${PRODUCT_NAME}: no routing rule matched ${file.name}.${capHint}`;
    }
    return `${PRODUCT_NAME}: ${file.name} → ${match.destinationPath} via “${match.rule.name}”.${capHint}`;
  }

  private routeFile(file: TFile, mode: RouteMode): Promise<"moved" | "skipped" | "failed"> {
    // Every actual move runs on the serialized route chain (see enqueueRoute) so
    // concurrent routes can't race the check-then-rename step.
    return this.enqueueRoute(() => this.doRouteFile(file, mode));
  }

  private async doRouteFile(
    file: TFile,
    mode: RouteMode
  ): Promise<"moved" | "skipped" | "failed"> {
    const manual = mode === "manual";

    if (this.settings.autoRouteOnlyInbox) {
      const inboxFolder = normalizeFolder(this.settings.inboxFolder || "Inbox");
      const isInInbox = file.path.startsWith(`${inboxFolder}/`) || file.parent?.path === inboxFolder;
      if (!isInInbox) return "skipped";
    }

    const candidate = this.toCandidate(file, this.app.metadataCache.getFileCache(file));
    const match = findRoute(this.settings.rules, candidate, this.isPro);
    if (!match) {
      if (manual) new Notice(`${PRODUCT_NAME}: no routing rule matched ${file.name}.`);
      return "skipped";
    }

    // Normalize BEFORE the uniqueness check so the string we test for collisions
    // is byte-for-byte the string we rename to (normalizePath can fold slashes
    // and Unicode, which would otherwise desync check and write).
    const normalizedDest = normalizePath(match.destinationPath);
    if (normalizedDest === file.path) {
      if (manual) new Notice(`${PRODUCT_NAME}: ${file.name} is already where it belongs.`);
      return "skipped";
    }

    const targetPath = this.uniqueTargetPath(normalizedDest, file);
    try {
      await this.ensureFolderExists(match.destinationFolder);
      await this.app.fileManager.renameFile(file, targetPath);
    } catch (error) {
      // Announce failures for manual and auto routes; the bulk sweep reports
      // them in its summary instead.
      if (mode !== "bulk") {
        new Notice(`${PRODUCT_NAME}: could not move ${file.name} — ${describeError(error)}`);
      }
      return "failed";
    }
    // A manual command always confirms; auto-routing confirms only when the user
    // has left "show move notices" on; the bulk sweep stays silent per-note.
    if (manual || (mode === "auto" && this.settings.showMoveNotice)) {
      new Notice(`${PRODUCT_NAME}: moved ${file.name} → ${targetPath}`);
    }
    return "moved";
  }

  private toCandidate(file: TFile, cache: CachedMetadata | null): CandidateNote {
    const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
    const inlineTags = (cache?.tags ?? []).map((tag) => tag.tag.replace(/^#/, ""));
    const frontmatterTags = flattenTags(frontmatter.tags);
    return {
      path: file.path,
      basename: file.basename,
      filename: file.name,
      extension: file.extension,
      tags: Array.from(new Set([...inlineTags, ...frontmatterTags])),
      frontmatter,
    };
  }

  private uniqueTargetPath(normalizedTarget: string, movingFile: TFile): string {
    // Compare case-insensitively and exclude the file being routed. Obsidian's
    // path map is case-sensitive, but the underlying FS on Windows/macOS is not,
    // so a case-only match (Report.md vs report.md) must still be treated as a
    // collision or renameFile would overwrite the on-disk file. Excluding the
    // moving file keeps an already-correctly-filed note from being bumped to "2".
    // Fold to NFC + lowercase so a decomposed (NFD, macOS) on-disk name and a
    // composed target that look identical are still seen as a collision.
    const fold = (path: string): string => path.normalize("NFC").toLowerCase();
    const taken = new Set<string>();
    for (const existing of this.app.vault.getAllLoadedFiles()) {
      if (existing.path === movingFile.path) continue;
      taken.add(fold(existing.path));
    }
    if (!taken.has(fold(normalizedTarget))) return normalizedTarget;

    const slash = normalizedTarget.lastIndexOf("/");
    const dot = normalizedTarget.lastIndexOf(".");
    const hasExt = dot > slash; // ignore dots that live in a folder segment
    const base = hasExt ? normalizedTarget.slice(0, dot) : normalizedTarget;
    const ext = hasExt ? normalizedTarget.slice(dot) : "";
    let counter = 2;
    while (true) {
      const next = `${base} ${counter}${ext}`;
      if (!taken.has(fold(next))) return next;
      counter += 1;
    }
  }

  private async ensureFolderExists(folder: string): Promise<void> {
    const clean = normalizeFolder(folder);
    if (!clean) return;
    const parts = clean.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try {
          await this.app.vault.createFolder(current);
        } catch (error) {
          // Another concurrent route may have created it between the check and
          // now; only rethrow if it still genuinely doesn't exist.
          if (!this.app.vault.getAbstractFileByPath(current)) throw error;
        }
      }
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

// structuredClone isn't available on older mobile WebViews that still satisfy
// minAppVersion; fall back to a JSON round-trip (settings are plain JSON, so
// this is lossless) rather than throwing during onload.
function clonePlain<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function flattenTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).replace(/^#/, "").trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(/[ ,]+/)
      .map((item) => item.replace(/^#/, "").trim())
      .filter(Boolean);
  }
  return [];
}
