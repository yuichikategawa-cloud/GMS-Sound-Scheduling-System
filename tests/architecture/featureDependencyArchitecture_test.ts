/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type FeatureSource = {
  path: string;
  url: URL;
  source: string;
};

async function collectFeatureSources(directory: URL, repoRoot: URL): Promise<FeatureSource[]> {
  const result: FeatureSource[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const child = new URL(entry.isDirectory ? entry.name + "/" : entry.name, directory);
    if (entry.isDirectory) {
      result.push(...await collectFeatureSources(child, repoRoot));
    } else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) {
      result.push({
        path: decodeURIComponent(child.pathname.slice(repoRoot.pathname.length)),
        url: child,
        source: await Deno.readTextFile(child),
      });
    }
  }
  return result;
}

function collectImportSpecifiers(source: string): string[] {
  const result = new Set<string>();
  for (const match of source.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)) {
    result.add(match[1]);
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    result.add(match[1]);
  }
  return [...result];
}

function moduleKey(path: string): string {
  return path.replace(/\.(?:tsx?|jsx?)$/, "");
}

Deno.test("feature modules respect dependency direction and contain no local import cycles", async () => {
  const repoRoot = new URL("../../", import.meta.url);
  const sources = await collectFeatureSources(new URL("../../src/features/", import.meta.url), repoRoot);
  const modules = new Map(sources.map(item => [moduleKey(item.path), item]));
  const adjacency = new Map<string, string[]>();
  const boundaryViolations: string[] = [];

  for (const item of sources) {
    const owner = item.path.split("/")[2];
    const currentKey = moduleKey(item.path);
    const dependencies: string[] = [];

    for (const specifier of collectImportSpecifiers(item.source)) {
      let targetPath: string | null = null;
      if (specifier.startsWith(".")) {
        const targetUrl = new URL(specifier, item.url);
        if (targetUrl.pathname.startsWith(repoRoot.pathname)) {
          targetPath = decodeURIComponent(targetUrl.pathname.slice(repoRoot.pathname.length));
        }
      } else {
        const alias = specifier.match(/^(?:@\/|src\/)features\/([^/]+)\/(.+)$/);
        if (alias) targetPath = "src/features/" + alias[1] + "/" + alias[2];
        const appAlias = /^(?:@\/|src\/)app\//.test(specifier);
        if (appAlias) boundaryViolations.push(item.path + " imports app implementation via " + specifier);
      }

      if (!targetPath) continue;
      if (targetPath === "src/App.tsx" || targetPath.startsWith("src/app/")) {
        boundaryViolations.push(item.path + " imports the App composition root via " + specifier);
        continue;
      }

      const match = targetPath.match(/^src\/features\/([^/]+)\//);
      if (!match) continue;
      if (match[1] !== owner) {
        boundaryViolations.push(item.path + " imports " + match[1] + " feature implementation via " + specifier);
        continue;
      }

      const targetKey = moduleKey(targetPath);
      if (modules.has(targetKey)) dependencies.push(targetKey);
    }
    adjacency.set(currentKey, dependencies);
  }

  assert(boundaryViolations.length === 0,
    "Feature dependency direction violations:\n" + boundaryViolations.join("\n"));

  const visited = new Set<string>();
  const active: string[] = [];
  const cycles: string[] = [];
  function visit(path: string): void {
    if (visited.has(path)) return;
    const existing = active.indexOf(path);
    if (existing >= 0) {
      cycles.push([...active.slice(existing), path].join(" -> "));
      return;
    }
    active.push(path);
    for (const dependency of adjacency.get(path) ?? []) visit(dependency);
    active.pop();
    visited.add(path);
  }

  for (const path of adjacency.keys()) visit(path);
  assert(cycles.length === 0, "Feature-local import cycles detected:\n" + cycles.join("\n"));
});
