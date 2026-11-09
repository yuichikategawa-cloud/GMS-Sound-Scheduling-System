/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Vercel Git deployments require an explicit branch allowlist", async () => {
  const source = await Deno.readTextFile(new URL("../../vercel.json", import.meta.url));
  const config = JSON.parse(source) as {
    git?: { deploymentEnabled?: boolean | Record<string, boolean> };
  };
  const deploymentEnabled = config.git?.deploymentEnabled;

  assert(
    typeof deploymentEnabled === "object" && deploymentEnabled !== null,
    "Vercel Git deployment rules must use an explicit branch map.",
  );
  assert(
    deploymentEnabled["**"] === false,
    "Unapproved branches, including feature branches, must not auto-deploy.",
  );
  assert(
    deploymentEnabled.main === true,
    "The Production branch must remain eligible for deployment.",
  );
  assert(
    deploymentEnabled.develop === false,
    "The develop branch must not create automatic Preview deployments.",
  );
});
