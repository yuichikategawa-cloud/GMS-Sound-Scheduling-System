/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory) {
      files.push(...await collectTypeScriptFiles(path));
    } else if (entry.isFile && /\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

function resolveRelativeImport(sourcePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const parts = sourcePath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

function importedSpecifiers(source: string): string[] {
  const matches = [
    ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
    ...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
  ];
  return [...new Set(matches.map(match => match[1]))];
}

Deno.test("feature and shared modules do not depend on other feature implementations", async () => {
  const featureFiles = await collectTypeScriptFiles("src/features");
  const sharedFiles = await collectTypeScriptFiles("src/shared");
  const violations: string[] = [];

  for (const sourcePath of featureFiles) {
    const sourceFeature = sourcePath.split("/")[2];
    const source = await Deno.readTextFile(sourcePath);
    for (const specifier of importedSpecifiers(source)) {
      const targetPath = resolveRelativeImport(sourcePath, specifier);
      if (!targetPath) continue;

      const targetParts = targetPath.split("/");
      if (targetParts[0] === "src" && targetParts[1] === "features") {
        const targetFeature = targetParts[2];
        if (targetFeature !== sourceFeature) {
          violations.push(sourcePath + " imports " + specifier + " (" + targetFeature + " feature)");
        }
      }
      if (targetParts[0] === "src" && targetParts[1] === "app") {
        violations.push(sourcePath + " imports app implementation " + specifier);
      }
    }
  }

  for (const sourcePath of sharedFiles) {
    const source = await Deno.readTextFile(sourcePath);
    for (const specifier of importedSpecifiers(source)) {
      const targetPath = resolveRelativeImport(sourcePath, specifier);
      if (!targetPath) continue;
      const targetParts = targetPath.split("/");
      if (targetParts[0] === "src" && targetParts[1] === "features") {
        violations.push(sourcePath + " imports feature implementation " + specifier);
      }
      if (targetParts[0] === "src" && targetParts[1] === "app") {
        violations.push(sourcePath + " imports app implementation " + specifier);
      }
    }
  }

  assert(
    violations.length === 0,
    "Feature dependency direction must flow through shared contracts and app composition, not feature-to-feature imports:\n" +
      violations.join("\n"),
  );
});
