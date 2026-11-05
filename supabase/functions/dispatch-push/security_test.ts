import { isAllowedPushEndpoint } from "./security.ts";

Deno.test("accepts supported browser push-service endpoints", () => {
  const valid = [
    "https://fcm.googleapis.com/fcm/send/test-endpoint-token",
    "https://fcm.googleapis.com:443/fcm/send/test-endpoint-token",
    "https://android.googleapis.com/gcm/send/test-endpoint-token",
    "https://updates.push.services.mozilla.com/wpush/v2/test-endpoint-token",
    "https://push.services.mozilla.com/wpush/v2/test-endpoint-token",
    "https://web.push.apple.com/Q-test-endpoint-token",
    "https://web2.push.apple.com/Q-test-endpoint-token",
    "https://a.b.push.apple.com/Q-test-endpoint-token",
    "https://wns2-example.notify.windows.com/w/?token=test-endpoint-token",
  ];

  for (const endpoint of valid) {
    if (!isAllowedPushEndpoint(endpoint)) {
      throw new Error("Expected supported endpoint to be accepted: " + endpoint);
    }
  }
});


Deno.test("accepts Chrome on Android Web Push endpoints routed through Google FCM", () => {
  // Chrome on Android uses the browser Web Push API. Its PushSubscription
  // endpoint is supplied by Chrome's push service (Google FCM), not a native
  // Android SDK registration token.
  const endpoint =
    "https://fcm.googleapis.com/fcm/send/chrome-android-webpush-test-endpoint";

  if (!isAllowedPushEndpoint(endpoint)) {
    throw new Error("Chrome on Android FCM Web Push endpoint was rejected");
  }
});

Deno.test("retains compatibility with the legacy Google Android GCM endpoint", () => {
  const endpoint =
    "https://android.googleapis.com/gcm/send/legacy-android-webpush-test-endpoint";

  if (!isAllowedPushEndpoint(endpoint)) {
    throw new Error("Legacy Google Android endpoint was rejected");
  }
});

Deno.test("rejects arbitrary hosts, private addresses and insecure endpoints", () => {
  const invalid = [
    "http://fcm.googleapis.com/fcm/send/test-endpoint-token",
    "https://127.0.0.1/fcm/send/test-endpoint-token",
    "https://localhost/fcm/send/test-endpoint-token",
    "https://192.168.1.10/fcm/send/test-endpoint-token",
    "https://fcm.googleapis.com.attacker.example/fcm/send/test-endpoint-token",
    "https://attacker.example/fcm/send/test-endpoint-token",
    "https://user@fcm.googleapis.com/fcm/send/test-endpoint-token",
    "https://fcm.googleapis.com:8443/fcm/send/test-endpoint-token",
    "https://fcm.googleapis.com/fcm/send/test-endpoint-token#fragment",
    "https://fcm.googleapis.com",
    "https://push.apple.com/Q-test-endpoint-token",
    "https://push.apple.com.attacker.example/Q-test-endpoint-token",
    "https://attackerpush.apple.com/Q-test-endpoint-token",
  ];

  for (const endpoint of invalid) {
    if (isAllowedPushEndpoint(endpoint)) {
      throw new Error("Expected endpoint to be rejected: " + endpoint);
    }
  }
});

Deno.test("rejects malformed, oversized and whitespace-padded values", () => {
  if (isAllowedPushEndpoint("not-a-url")) {
    throw new Error("Malformed endpoint was accepted");
  }
  if (isAllowedPushEndpoint(" https://fcm.googleapis.com/fcm/send/test-endpoint-token")) {
    throw new Error("Whitespace-padded endpoint was accepted");
  }
  if (isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/" + "x".repeat(2048))) {
    throw new Error("Oversized endpoint was accepted");
  }
});
