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

    // These two act on the active note, so gate them with checkCallback: they
    // hide/grey out in the palette when there's no Markdown note active instead
    // of appearing only to fire an error Notice. "Sweep inbox" stays a plain
    // callback since it's vault-global.
    this.addCommand({
      id: "route-current-note",
      name: "Route current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.routeCurrentNote();
        return true;
      },
    });

    this.addCommand({
      id: "preview-route-current-note",
      name: "Preview route for current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.previewCurrentNote();
        return true;
      },
    });

    this.addCommand({
      // Id stays "route-inbox-now" so existing hotkeys keep working; the
      // visible name matches the "Sweep" verb used in the docs and upgrade card.
      id: "route-inbox-now",
      name: "Sweep inbox",
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
          // When routing is scoped to the Inbox, a note created elsewhere would
          // only ever skip — don't track it, or it would sit in pendingCreated
          // for the session and re-run doRouteFile on every metadata change.
          if (this.settings.autoRouteOnlyInbox && !this.isInInbox(file)) return;
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

  // Route a newly-created note now that its cache is available. Keep it in the
  // pending set only while it's still "skipped" (e.g. its matching frontmatter
  // hasn't been typed) so a later index gives it another chance. Drop it once it
  // "moved" OR "failed": a move that throws (a persistent collision, a
  // non-folder parent) won't spontaneously succeed on the next metadata change,
  // so retrying it would just re-fire the same error Notice on every edit.
  private async routeCreatedFile(file: TFile): Promise<void> {
    const result = await this.routeFile(file, "auto");
    if (result !== "skipped") this.pendingCreated.delete(file.path);
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
      .filter((file) => this.isInInbox(file));

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
        // Only flag the cap once we find a note that WOULD have moved but was
        // blocked by the limit. getMarkdownFiles() order is arbitrary, so the
        // file after the last move is often a non-matching note — flagging the
        // cap on it would falsely claim "more remain" (and mis-sell Pro) when
        // everything routable was already filed. Keep scanning the remainder
        // and stop at the first genuine match.
        if (this.wouldRoute(file)) {
          hitCap = true;
          break;
        }
        continue;
      }
      const result = await this.routeFile(file, "bulk");
      if (result === "moved") moved += 1;
      else if (result === "failed") failed += 1;
      else skipped += 1;
    }

    let summary = `${PRODUCT_NAME}: moved ${moved}, skipped ${skipped}`;
    summary += failed ? `, failed ${failed}.` : ".";
    if (hitCap) {
      summary += ` Free stopped after ${FREE_BULK_LIMIT} moves this run — run it again to file any remaining matches, or upgrade to Pro for unlimited.`;
    }
    new Notice(summary, 7000);
  }

  private describeRoute(file: TFile): string {
    // Preview must respect the same inbox gate doRouteFile enforces, or it would
    // promise a move that "Route current note" then refuses for a note outside
    // the Inbox (autoRouteOnlyInbox defaults on).
    if (this.settings.autoRouteOnlyInbox && !this.isInInbox(file)) {
      return `${PRODUCT_NAME}: ${file.name} is outside your Inbox folder, so it won't be routed. Turn off “Only route notes inside the Inbox folder” to route notes anywhere.`;
    }
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
    // Report the exact path the route would use, not match.destinationPath: mirror
    // doRouteFile's already-there skip and its collision numbering so the dry run
    // never promises a path (Archive/Report.md) the route then bumps to a numbered
    // copy (Archive/Report 2.md).
    const normalizedDest = normalizePath(match.destinationPath);
    if (foldPath(normalizedDest) === foldPath(file.path)) {
      return `${PRODUCT_NAME}: ${file.name} is already where it belongs.${capHint}`;
    }
    const targetPath = this.uniqueTargetPath(normalizedDest, file);
    return `${PRODUCT_NAME}: ${file.name} → ${targetPath} via “${match.rule.name}”.${capHint}`;
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

    if (this.settings.autoRouteOnlyInbox && !this.isInInbox(file)) {
      // A manual command must never fail silently: tell the user why the note
      // stayed put and how to route notes that live outside the Inbox.
      if (manual) {
        new Notice(
          `${PRODUCT_NAME}: ${file.name} is outside your Inbox folder, so it wasn't moved. Turn off “Only route notes inside the Inbox folder” to route notes anywhere.`,
          7000
        );
      }
      return "skipped";
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
    // Treat "already filed" with the SAME NFC+case fold uniqueTargetPath uses,
    // not strict ===. A note whose on-disk path differs from the rendered
    // destination only by case or Unicode form is functionally already there;
    // a strict check would trigger an endless case-only rename every sweep.
    if (foldPath(normalizedDest) === foldPath(file.path)) {
      if (manual) new Notice(`${PRODUCT_NAME}: ${file.name} is already where it belongs.`);
      return "skipped";
    }

    const targetPath = this.uniqueTargetPath(normalizedDest, file);
    try {
      // Normalize the folder the same way as the rename target (normalizePath
      // folds Unicode to NFC) so the created folder is byte-identical to the
      // parent of normalizedDest — otherwise an NFD-derived segment would build
      // the folder in a form the NFC rename target can't find.
      await this.ensureFolderExists(normalizePath(match.destinationFolder));
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

  // True when the note lives in (or under) the configured Inbox folder. Folds
  // both sides to NFC + lowercase so this gate agrees with folder creation,
  // collision detection, and rule matching on case-insensitive filesystems
  // (Windows/macOS/mobile): a folder on disk named "inbox" still matches an
  // "Inbox" setting and vice versa, instead of silently routing nothing.
  private isInInbox(file: TFile): boolean {
    const inboxFolder = foldPath(normalizeFolder(this.settings.inboxFolder || "Inbox"));
    const path = foldPath(file.path);
    const parent = file.parent ? foldPath(file.parent.path) : "";
    return path.startsWith(`${inboxFolder}/`) || parent === inboxFolder;
  }

  // Dry evaluation: would doRouteFile actually move this note? The sweep uses it
  // to tell a genuine cap hit (a routable note the free limit blocked) from the
  // common case where the notes left after the last move simply match no rule,
  // so the "run it again / upgrade to Pro" notice can't falsely claim more remain.
  private wouldRoute(file: TFile): boolean {
    const candidate = this.toCandidate(file, this.app.metadataCache.getFileCache(file));
    const match = findRoute(this.settings.rules, candidate, this.isPro);
    if (!match) return false;
    // Mirror doRouteFile's fold-equal "already where it belongs" skip so a note
    // that resolves to its own path isn't counted as blocked work.
    return foldPath(normalizePath(match.destinationPath)) !== foldPath(file.path);
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
    const taken = new Set<string>();
    for (const existing of this.app.vault.getAllLoadedFiles()) {
      if (existing.path === movingFile.path) continue;
      taken.add(foldPath(existing.path));
    }
    if (!taken.has(foldPath(normalizedTarget))) return normalizedTarget;

    const slash = normalizedTarget.lastIndexOf("/");
    const dot = normalizedTarget.lastIndexOf(".");
    const hasExt = dot > slash; // ignore dots that live in a folder segment
    const base = hasExt ? normalizedTarget.slice(0, dot) : normalizedTarget;
    const ext = hasExt ? normalizedTarget.slice(dot) : "";
    let counter = 2;
    while (true) {
      const next = `${base} ${counter}${ext}`;
      if (!taken.has(foldPath(next))) return next;
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
          // createFolder can reject because a concurrent route already made it,
          // OR because a folder differing only by case exists on a
          // case-insensitive filesystem (Windows/macOS/mobile). The vault's path
          // map is case-sensitive and wouldn't reflect the latter, so consult the
          // adapter (real on-disk state) and only rethrow if it truly is missing.
          if (!(await this.app.vault.adapter.exists(current))) throw error;
        }
      }
    }
  }
}

// NFC + case fold so paths that differ only by Unicode form or letter case
// (macOS NFD, case-insensitive filesystems) compare equal.
function foldPath(path: string): string {
  return path.normalize("NFC").toLowerCase();
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
