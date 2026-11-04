const ALLOWED_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
]);

/**
 * Only permit known browser push-service origins. These endpoints are later
 * used for outbound HTTPS requests, so arbitrary hosts would create an SSRF
 * surface if an untrusted endpoint entered the subscription table.
 */
export function isAllowedPushEndpoint(value: string): boolean {
  if (
    typeof value !== "string" ||
    value.length < 40 ||
    value.length > 2048 ||
    value.trim() !== value ||
    /[\s\u0000-\u001f]/.test(value)
  ) {
    return false;
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return false;
  }

  const host = endpoint.hostname.toLowerCase();
  const isMicrosoftWnsHost =
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.notify\.windows\.com$/.test(host);

  return endpoint.protocol === "https:" &&
    endpoint.username === "" &&
    endpoint.password === "" &&
    endpoint.port === "" &&
    endpoint.pathname.length > 1 &&
    endpoint.hash === "" &&
    (ALLOWED_PUSH_HOSTS.has(host) || isMicrosoftWnsHost);
}
