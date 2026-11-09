/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Vercel configuration keeps main and develop eligible for deployments", async () => {
  const source = await Deno.readTextFile(new URL("../../vercel.json", import.meta.url));
  const config = JSON.parse(source) as {
    git?: { deploymentEnabled?: boolean | Record<string, boolean> };
  };
  const deploymentEnabled = config.git?.deploymentEnabled;
  if (typeof deploymentEnabled === "object" && deploymentEnabled !== null) {
    assert(deploymentEnabled.main !== false,
      "The Production branch must not be disabled by vercel.json.");
    assert(deploymentEnabled.develop !== false,
      "The development branch must not be disabled by vercel.json.");
  }
});
