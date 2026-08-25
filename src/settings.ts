import { App, Notice, PluginSettingTab, Setting, debounce } from "obsidian";
import { FREE_BULK_LIMIT, FREE_RULE_LIMIT, PRODUCT_NAME, PRO_PRICE, PURCHASE_URL } from "./product";
import type { RoutingRule, VaultRouterSettings } from "./types";
import type VaultRouterPlugin from "./main";
import { RuleEditModal } from "./ui/RuleEditModal";

export const DEFAULT_SETTINGS: VaultRouterSettings = {
  inboxFolder: "Inbox",
  routeOnCreate: false,
  autoRouteOnlyInbox: true,
  showMoveNotice: true,
  licenseKey: "",
  licenseStatus: "free",
  rules: [
    {
      id: randomRuleId(),
      name: "Daily notes",
      enabled: true,
      titleStartsWith: "Daily -",
      pathIncludes: "Inbox",
      requiredTag: "",
      propertyKey: "",
      propertyValue: "",
      destinationFolder: "Journal/Daily",
    },
    {
      id: randomRuleId(),
      name: "Meeting notes",
      enabled: true,
      titleStartsWith: "",
      pathIncludes: "Inbox",
      requiredTag: "meeting",
      propertyKey: "project",
      propertyValue: "",
      destinationFolder: "Meetings/{{frontmatter:project}}",
    },
  ],
};

export class VaultRouterSettingTab extends PluginSettingTab {
  plugin: VaultRouterPlugin;

  constructor(app: App, plugin: VaultRouterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Inbox and routing")
      .setHeading()
      .setDesc(
        "Vault Router moves notes into the right folder using your rules. Run it from the command palette: Route current note, Preview route for current note, and Sweep inbox."
      );

    const saveInboxFolder = debounce(() => void this.plugin.saveSettings(), 400, false);
    new Setting(containerEl)
      .setName("Inbox folder")
      .setDesc("The folder “Sweep inbox” routes from. Notes here are matched against your rules and filed.")
      .addText((text) =>
        text.setPlaceholder("Inbox").setValue(this.plugin.settings.inboxFolder).onChange((value) => {
          this.plugin.settings.inboxFolder = value.trim();
          saveInboxFolder();
        })
      );

    // This toggle scopes BOTH manual and automatic routing (see doRouteFile),
    // so it lives with the inbox config, not under "Pro automation" — a Free
    // user must not dismiss it as a paid-only setting.
    new Setting(containerEl)
      .setName("Only route notes inside the Inbox folder")
      .setDesc("When on, both manual and automatic routing only move notes that live in your Inbox folder — notes anywhere else are left alone.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoRouteOnlyInbox).onChange((value) => {
          this.plugin.settings.autoRouteOnlyInbox = value;
          void this.plugin.saveSettings();
        })
      );

    const activeRuleCount = this.plugin.settings.rules.filter((rule) => rule.enabled).length;
    let rulesDesc: string;
    if (this.plugin.isPro) {
      rulesDesc = "First matching rule wins. Pro has no rule limit.";
    } else if (activeRuleCount > FREE_RULE_LIMIT) {
      // Name the overflow directly in the header — otherwise it reads as if only
      // the first N rules exist while more cards sit below, their skip only
      // discoverable per-card.
      const overflow = activeRuleCount - FREE_RULE_LIMIT;
      rulesDesc = `First matching rule wins. Free evaluates your first ${FREE_RULE_LIMIT} active rules — ${overflow} more ${overflow === 1 ? "is" : "are"} enabled but skipped.`;
    } else {
      rulesDesc = `First matching rule wins. Free evaluates up to ${FREE_RULE_LIMIT} active rules (${activeRuleCount} of ${FREE_RULE_LIMIT} used).`;
    }

    new Setting(containerEl)
      .setName("Routing rules")
      .setHeading()
      .setDesc(rulesDesc);

    // Mirror findRoute: for a free user, active rules past the cap never fire.
    const cappedRuleIds = new Set<string>();
    if (!this.plugin.isPro) {
      let activeSeen = 0;
      for (const rule of this.plugin.settings.rules) {
        if (!rule.enabled) continue;
        activeSeen += 1;
        if (activeSeen > FREE_RULE_LIMIT) cappedRuleIds.add(rule.id);
      }
    }

    if (!this.plugin.settings.rules.length) {
      containerEl.createDiv({
        cls: "vault-router-rule-summary",
        text: "No rules yet. Add one below — a rule matches on title, path, tag, or property, and the first matching rule decides where a note goes.",
      });
    }

    for (const [index, rule] of this.plugin.settings.rules.entries()) {
      const card = containerEl.createDiv({ cls: "vault-router-rule-card" });
      card.createEl("strong", { text: `${index + 1}. ${rule.name}` });
      card.createDiv({
        cls: "vault-router-rule-summary",
        text: summarizeRule(rule),
      });
      if (cappedRuleIds.has(rule.id)) {
        card.createDiv({
          cls: "vault-router-rule-capped",
          text: `Enabled, but skipped on Free — beyond the ${FREE_RULE_LIMIT}-rule limit. Unlock Pro to run it.`,
        });
      }

      new Setting(card)
        .addButton((button) =>
          button.setButtonText("Edit").onClick(() => {
            new RuleEditModal(this.app, rule, (nextRule) => {
              this.plugin.settings.rules[index] = nextRule;
              void this.plugin.saveSettings().then(() => this.display());
            }).open();
          })
        )
        .addExtraButton((button) =>
          button.setIcon("up-chevron-glyph").setTooltip("Move up").onClick(() => {
            if (index === 0) return;
            swap(this.plugin.settings.rules, index, index - 1);
            void this.plugin.saveSettings().then(() => this.display());
          })
        )
        .addExtraButton((button) =>
          button.setIcon("down-chevron-glyph").setTooltip("Move down").onClick(() => {
            if (index >= this.plugin.settings.rules.length - 1) return;
            swap(this.plugin.settings.rules, index, index + 1);
            void this.plugin.saveSettings().then(() => this.display());
          })
        )
        .addExtraButton((button) =>
          button
            .setIcon(rule.enabled ? "toggle-right" : "toggle-left")
            .setTooltip(rule.enabled ? "Disable rule" : "Enable rule")
            .onClick(() => {
              rule.enabled = !rule.enabled;
              void this.plugin.saveSettings().then(() => this.display());
            })
        )
        .addExtraButton((button) =>
          button.setIcon("trash").setTooltip("Delete rule").onClick(() => {
            this.plugin.settings.rules.splice(index, 1);
            void this.plugin.saveSettings().then(() => this.display());
          })
        );
    }

    new Setting(containerEl)
      .setName("Add routing rule")
      .setDesc("Create a rule that decides where matching notes go when you route them.")
      .addButton((button) =>
        button.setButtonText("Add rule").setCta().onClick(() => {
          const rule = emptyRule();
          new RuleEditModal(
            this.app,
            rule,
            (nextRule) => {
              this.plugin.settings.rules.push(nextRule);
              void this.plugin.saveSettings().then(() => this.display());
            },
            { isNew: true }
          ).open();
        })
      );

    // Automation and the upgrade card come last: lead with core setup (inbox +
    // rules), sell after the user understands what a rule does.
    new Setting(containerEl)
      .setName("Pro automation")
      .setHeading();

    new Setting(containerEl)
      .setName("Auto-route newly created notes")
      .setDesc("Pro feature. When enabled, new notes are routed shortly after creation.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.routeOnCreate).onChange((value) => {
          if (value && !this.plugin.isPro) {
            toggle.setValue(false);
            new Notice(`${PRODUCT_NAME}: auto-routing on create is a Pro feature.`);
            return;
          }
          this.plugin.settings.routeOnCreate = value;
          void this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show move notices")
      .setDesc("Pro feature. Show a notice each time a note is auto-routed. Manual and preview commands always report their result.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showMoveNotice).onChange((value) => {
          this.plugin.settings.showMoveNotice = value;
          void this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("License and unlock")
      .setHeading();

    this.renderUpgradeCard(containerEl);

    new Setting(containerEl)
      .setName("Offline Pro license key")
      .setDesc(
        this.plugin.isPro
          ? "Your license key is saved. Clear this field to switch back to Free."
          : this.plugin.licenseError ?? "Unlock Pro with your one-time license key."
      )
      .addTextArea((text) => {
        // Debounced so pasting/typing a key doesn't re-verify + re-render (and
        // steal focus) on every keystroke; it settles once the user pauses.
        const applyLicense = debounce(() => {
          this.plugin.refreshLicense();
          void this.plugin.saveSettings();
          this.display();
        }, 500, false);
        text.setPlaceholder("Paste your license key from the purchase email");
        text.setValue(this.plugin.settings.licenseKey);
        text.onChange((value) => {
          this.plugin.settings.licenseKey = value.trim();
          applyLicense();
        });
        return text;
      });

    new Setting(containerEl).setName("Feedback").setHeading();

    new Setting(containerEl)
      .setName("Bugs and feature requests")
      .setDesc("Issues and ideas are tracked on GitHub. Opens in your browser.")
      .addButton((button) =>
        button.setButtonText("Report a bug").onClick(() => {
          window.open("https://github.com/israerusan/vault-router/issues/new?labels=bug");
        })
      )
      .addButton((button) =>
        button.setButtonText("Request a feature").onClick(() => {
          window.open("https://github.com/israerusan/vault-router/issues/new?labels=enhancement");
        })
      );
  }

  // The upgrade card is the one moment of "selling" in the settings tab. When
  // the user is already Pro it collapses to a quiet confirmation; otherwise it
  // states the price once, lists exactly what Pro unlocks, and offers a single
  // outbound checkout link — no nagging, no repeated CTAs elsewhere.
  private renderUpgradeCard(containerEl: HTMLElement): void {
    if (this.plugin.isPro) {
      const active = containerEl.createDiv({ cls: "vault-router-pro-active" });
      active.createSpan({ cls: "vault-router-pro-badge", text: "PRO" });
      active.createSpan({
        text: this.plugin.licenseEmail
          ? `Thanks for going Pro — unlocked for ${this.plugin.licenseEmail}.`
          : "Thanks for going Pro — every limit is lifted.",
      });
      return;
    }

    const card = containerEl.createDiv({ cls: "vault-router-upgrade-card" });

    const header = card.createDiv({ cls: "vault-router-upgrade-header" });
    header.createEl("strong", {
      cls: "vault-router-upgrade-title",
      text: "Vault Router Pro",
    });
    header.createSpan({
      cls: "vault-router-upgrade-price",
      text: `${PRO_PRICE} · one-time`,
    });

    card.createDiv({
      cls: "vault-router-upgrade-tagline",
      text: "Turn manual, capped routing into hands-off automation.",
    });

    const benefits = card.createEl("ul", { cls: "vault-router-upgrade-benefits" });
    for (const benefit of [
      `Unlimited routing rules — Free stops at ${FREE_RULE_LIMIT} active.`,
      `No per-sweep move cap — Free routes up to ${FREE_BULK_LIMIT} notes per sweep.`,
      "Auto-route new notes for you — no more manual filing.",
    ]) {
      benefits.createEl("li", { text: benefit });
    }

    const cta = card.createEl("a", {
      cls: "vault-router-upgrade-cta",
      text: `Unlock Pro — ${PRO_PRICE}`,
      href: PURCHASE_URL,
    });
    cta.setAttr("target", "_blank");
    cta.setAttr("rel", "noopener noreferrer");

    card.createDiv({
      cls: "vault-router-upgrade-reassure",
      text: "Keys verify offline with Ed25519 — no account, no server, no subscription.",
    });
  }
}

function summarizeRule(rule: RoutingRule): string {
  const checks = [
    rule.titleStartsWith ? `title starts with “${rule.titleStartsWith}”` : "",
    rule.pathIncludes ? `path includes “${rule.pathIncludes}”` : "",
    rule.requiredTag ? `tag #${rule.requiredTag.replace(/^#/, "")}` : "",
    rule.propertyKey ? `property ${rule.propertyKey}${rule.propertyValue ? `=${rule.propertyValue}` : " exists"}` : "",
  ].filter(Boolean);
  const when = checks.length ? checks.join(" + ") : "always matches";
  return `${rule.enabled ? "Enabled" : "Disabled"} • ${when} → ${rule.destinationFolder || "(missing destination)"}`;
}

function swap<T>(items: T[], a: number, b: number): void {
  const temp = items[a];
  items[a] = items[b];
  items[b] = temp;
}

export function emptyRule(): RoutingRule {
  return {
    id: randomRuleId(),
    name: "New rule",
    enabled: true,
    titleStartsWith: "",
    pathIncludes: "",
    requiredTag: "",
    propertyKey: "",
    propertyValue: "",
    destinationFolder: "",
  };
}

function randomRuleId(): string {
  // Prefer a real UUID when the platform exposes one (popout-safe via window);
  // fall back to a short random token where crypto is unavailable.
  const uuid = window.crypto?.randomUUID?.();
  return uuid ?? Math.random().toString(36).slice(2, 10);
}
