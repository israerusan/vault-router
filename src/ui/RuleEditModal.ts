import { App, Modal, Setting, TextComponent, ToggleComponent } from "obsidian";
import type { RoutingRule } from "../types";

type SaveHandler = (rule: RoutingRule) => void;

export class RuleEditModal extends Modal {
  private rule: RoutingRule;
  private readonly onSave: SaveHandler;
  private readonly isNew: boolean;
  private messageEl!: HTMLElement;
  private catchAllConfirmed = false;

  constructor(app: App, initialRule: RoutingRule, onSave: SaveHandler, options?: { isNew?: boolean }) {
    super(app);
    this.rule = { ...initialRule };
    this.onSave = onSave;
    // Every rule (including a brand-new one) carries a generated id, so we can't
    // infer add-vs-edit from the id — the caller tells us explicitly.
    this.isNew = options?.isNew ?? false;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    // Use the Modal's own title element rather than injecting a custom heading
    // (Obsidian UI guideline; keeps us clear of the review bot). Write via
    // titleEl.setText rather than setTitle(): titleEl has existed on Modal far
    // longer than our declared minAppVersion (1.4.0), whereas setTitle() is a
    // newer helper that would throw on older supported clients.
    this.titleEl.setText(this.isNew ? "Add routing rule" : "Edit routing rule");

    this.addTextField(contentEl, "Rule name", this.rule.name, (value) => {
      this.rule.name = value;
    }, "Daily notes");

    this.addTextField(contentEl, "Destination folder", this.rule.destinationFolder, (value) => {
      this.rule.destinationFolder = value;
    }, "Projects/{{frontmatter:project}}/Notes");

    contentEl.createDiv({
      cls: "vault-router-rule-help",
      text: "Destination supports {{frontmatter:key}}, {{basename}}, {{filename}}, and {{ext}}.",
    });

    contentEl.createEl("h4", { cls: "vault-router-rule-section", text: "Match when" });
    contentEl.createDiv({
      cls: "vault-router-rule-help",
      text: "A note is routed only when it satisfies every condition you fill in below. Leave a field blank to ignore it.",
    });

    this.addTextField(contentEl, "Title starts with", this.rule.titleStartsWith, (value) => {
      this.rule.titleStartsWith = value;
    }, "Daily -");

    this.addTextField(contentEl, "Path includes", this.rule.pathIncludes, (value) => {
      this.rule.pathIncludes = value;
    }, "Inbox/");

    this.addTextField(contentEl, "Required tag", this.rule.requiredTag, (value) => {
      this.rule.requiredTag = value;
    }, "meeting");

    this.addTextField(contentEl, "Property key", this.rule.propertyKey, (value) => {
      this.rule.propertyKey = value;
    }, "project");

    this.addTextField(contentEl, "Property value", this.rule.propertyValue, (value) => {
      this.rule.propertyValue = value;
    }, "alpha");

    contentEl.createDiv({
      cls: "vault-router-rule-help",
      text: "Leave the property value empty to match whenever the property just exists.",
    });

    this.addToggleField(contentEl, "Enabled", this.rule.enabled, (value) => {
      this.rule.enabled = value;
    });

    this.messageEl = contentEl.createDiv({ cls: "vault-router-rule-message" });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Save").setCta().onClick(() => this.trySave())
      )
      .addExtraButton((button) => button.setIcon("cross").setTooltip("Cancel").onClick(() => this.close()));
  }

  private trySave(): void {
    this.rule.name = this.rule.name.trim() || "Untitled rule";
    this.rule.destinationFolder = this.rule.destinationFolder.trim();

    // A destination is required — without it the engine silently rejects the
    // rule at route time, which reads as "the rule just doesn't work."
    if (!this.rule.destinationFolder) {
      this.showMessage("Destination folder is required.");
      return;
    }

    // A rule with no conditions matches EVERY note. Allow it (it's a valid
    // catch-all) but require a second, deliberate click first.
    const hasCondition = [
      this.rule.titleStartsWith,
      this.rule.pathIncludes,
      this.rule.requiredTag,
      this.rule.propertyKey,
    ].some((field) => field.trim());
    if (!hasCondition && !this.catchAllConfirmed) {
      this.catchAllConfirmed = true;
      this.showMessage("This rule has no conditions and will match every note. Click Save again to confirm.");
      return;
    }

    this.onSave({ ...this.rule });
    this.close();
  }

  private showMessage(text: string): void {
    this.messageEl.setText(text);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addTextField(
    containerEl: HTMLElement,
    name: string,
    value: string,
    onChange: (value: string) => void,
    placeholder: string
  ): TextComponent {
    let component!: TextComponent;
    new Setting(containerEl).setName(name).addText((text) => {
      component = text;
      text.setValue(value).setPlaceholder(placeholder).onChange(onChange);
      return text;
    });
    return component;
  }

  private addToggleField(
    containerEl: HTMLElement,
    name: string,
    value: boolean,
    onChange: (value: boolean) => void
  ): ToggleComponent {
    let component!: ToggleComponent;
    new Setting(containerEl).setName(name).addToggle((toggle) => {
      component = toggle;
      toggle.setValue(value).onChange(onChange);
      return toggle;
    });
    return component;
  }
}
