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
      "obsidianmd/ui/sentence-case": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off"
    }
  }
);
