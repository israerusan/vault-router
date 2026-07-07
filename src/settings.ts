import { App, Notice, PluginSettingTab, Setting, debounce } from "obsidian";
import { FREE_RULE_LIMIT, PRODUCT_NAME } from "./product";
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
      .setName("Inbox and manual routing")
      .setHeading();

    const saveInboxFolder = debounce(() => void this.plugin.saveSettings(), 400, false);
    new Setting(containerEl)
      .setName("Inbox folder")
      .setDesc("Only route inbox notes from this folder when the inbox-only toggle is on.")
      .addText((text) =>
        text.setPlaceholder("Inbox").setValue(this.plugin.settings.inboxFolder).onChange((value) => {
          this.plugin.settings.inboxFolder = value.trim();
          saveInboxFolder();
        })
      );

    new Setting(containerEl)
      .setName("Show move notices")
      .setDesc("Show a notice when a note is auto-routed. Manual commands always confirm the result.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showMoveNotice).onChange((value) => {
          this.plugin.settings.showMoveNotice = value;
          void this.plugin.saveSettings();
        })
      );

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
      .setName("Only auto-route notes from Inbox")
      .setDesc("Safer default. Prevents random note teleports when you are working fast.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoRouteOnlyInbox).onChange((value) => {
          this.plugin.settings.autoRouteOnlyInbox = value;
          void this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("License and unlock")
      .setHeading();

    new Setting(containerEl)
      .setName("Offline Pro license key")
      .setDesc(
        this.plugin.isPro
          ? `Pro unlocked for ${this.plugin.licenseEmail ?? "this vault"}.`
          : this.plugin.licenseError ?? "Paste your one-time license key to unlock Pro."
      )
      .addTextArea((text) => {
        // Debounced so pasting/typing a key doesn't re-verify + re-render (and
        // steal focus) on every keystroke; it settles once the user pauses.
        const applyLicense = debounce(() => {
          this.plugin.refreshLicense();
          void this.plugin.saveSettings();
          this.display();
        }, 500, false);
        text.setPlaceholder("base64url(payload).base64url(signature)");
        text.setValue(this.plugin.settings.licenseKey);
        text.onChange((value) => {
          this.plugin.settings.licenseKey = value.trim();
          applyLicense();
        });
        return text;
      });

    const activeRuleCount = this.plugin.settings.rules.filter((rule) => rule.enabled).length;
    const rulesDesc = this.plugin.isPro
      ? "First matching rule wins. Pro has no rule limit."
      : `First matching rule wins. Free evaluates your first ${FREE_RULE_LIMIT} active rules (${Math.min(activeRuleCount, FREE_RULE_LIMIT)} of ${FREE_RULE_LIMIT} used).`;

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
          text: `Inactive on Free — beyond the ${FREE_RULE_LIMIT}-rule limit. Upgrade to Pro to run it.`,
        });
      }

      new Setting(card)
        .setName("Rule actions")
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
      .setDesc("Make the machine do the filing so you do not have to.")
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
