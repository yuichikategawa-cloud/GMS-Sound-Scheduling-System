/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Vercel Git integration skips Preview deployments for the modularization branch only", async () => {
  const source = await Deno.readTextFile(new URL("../../vercel.json", import.meta.url));
  const config = JSON.parse(source) as {
    git?: { deploymentEnabled?: boolean | Record<string, boolean> };
  };
  const deploymentEnabled = config.git?.deploymentEnabled;
  assert(typeof deploymentEnabled === "object" && deploymentEnabled !== null,
    "Vercel must use a branch-specific deploymentEnabled map.");
  assert(deploymentEnabled["security/push-endpoint-hardening"] === false,
    "Vercel Preview deployments must be disabled for security/push-endpoint-hardening.");
  assert(!("main" in deploymentEnabled),
    "The production branch must not be disabled by the branch-specific Preview guard.");
});
