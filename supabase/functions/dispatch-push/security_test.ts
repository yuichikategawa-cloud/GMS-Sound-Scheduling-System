import { isAllowedPushEndpoint } from "./security.ts";

Deno.test("accepts supported browser push-service endpoints", () => {
  const valid = [
    "https://fcm.googleapis.com/fcm/send/test-endpoint-token",
    "https://android.googleapis.com/gcm/send/test-endpoint-token",
    "https://updates.push.services.mozilla.com/wpush/v2/test-endpoint-token",
    "https://push.services.mozilla.com/wpush/v2/test-endpoint-token",
    "https://web.push.apple.com/Q-test-endpoint-token",
    "https://wns2-example.notify.windows.com/w/?token=test-endpoint-token",
  ];

  for (const endpoint of valid) {
    if (!isAllowedPushEndpoint(endpoint)) {
      throw new Error("Expected supported endpoint to be accepted: " + endpoint);
    }
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
