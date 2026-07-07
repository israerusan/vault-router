import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "tests/**",
      "test/**",
      "scripts/**",
      "esbuild.config.mjs",
      "eslint.config.mjs",
      "src/**/*.mjs",
      "src/**/*.d.mts",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Left off deliberately: this plugin's UI copy is dense with domain proper
      // nouns the rule can't model — "Inbox" (a folder name), "Pro" (the tier),
      // "Vault Router" (the product), and command-name references like "Sweep
      // inbox" — so it fires only false positives here. Suppressing each inline
      // would clutter the Setting chains and mask real regressions on those lines.
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off"
    }
  }
);
