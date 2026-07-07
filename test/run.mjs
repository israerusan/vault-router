import esbuild from "esbuild";
    import fs from "node:fs";
    import path from "node:path";
    import { pathToFileURL, fileURLToPath } from "node:url";

    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const testDir = path.join(root, "test");
    const buildDir = path.join(testDir, ".build");
    fs.mkdirSync(buildDir, { recursive: true });

    const tsTests = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.ts')).sort();
    for (const file of tsTests) {
      const outfile = path.join(buildDir, file.replace(/\.ts$/, '.cjs'));
      await esbuild.build({
        entryPoints: [path.join(testDir, file)],
        bundle: true,
        outfile,
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        logLevel: 'warning',
        alias: { obsidian: path.join(testDir, 'obsidian-stub.ts') },
      });
      await import(pathToFileURL(outfile).href);
      console.log(`ok  ${file}`);
    }

    const mjsTests = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).sort();
    for (const file of mjsTests) {
      await import(pathToFileURL(path.join(testDir, file)).href);
    }

    console.log("\nAll tests passed.");
