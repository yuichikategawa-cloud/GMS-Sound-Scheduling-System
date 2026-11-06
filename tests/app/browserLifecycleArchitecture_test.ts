/// <reference lib="deno.ns" />

const app = await Deno.readTextFile("src/App.tsx");
const hook = await Deno.readTextFile("src/app/hooks/useBrowserLifecycle.ts");
const service = await Deno.readTextFile("src/app/services/browserLifecycle.ts");

Deno.test("App delegates browser lifecycle ownership to the app hook", () => {
  if (!app.includes("useBrowserLifecycle({")) throw new Error("App must compose the browser lifecycle hook.");
  for (const eventName of ["beforeinstallprompt", "appinstalled", "visibilitychange", "pageshow"]) {
    if (app.includes(eventName)) throw new Error(`App must not register ${eventName} listeners directly.`);
  }
  if (/window\.addEventListener\(["'](online|offline)["']/.test(app)) {
    throw new Error("App must not own direct connectivity event listeners.");
  }
  if (!app.includes("clearInstallPrompt()")) throw new Error("App should clear the deferred install prompt through the hook API.");
});

Deno.test("browser lifecycle hook delegates event registration to testable app services", () => {
  for (const serviceFunction of [
    "registerPwaInstallLifecycle",
    "registerConnectionStatusLifecycle",
    "registerForegroundRefreshLifecycle",
  ]) {
    if (!hook.includes(serviceFunction) || !service.includes(`function ${serviceFunction}`)) {
      throw new Error(`Missing service boundary: ${serviceFunction}`);
    }
  }
  if (!hook.includes("lastForegroundRefresh = useRef(0)")) {
    throw new Error("Foreground refresh throttle state should be owned by the browser lifecycle hook.");
  }
});
