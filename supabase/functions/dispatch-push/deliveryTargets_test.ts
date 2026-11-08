import { getPendingPushSubscriptions } from "./deliveryTargets.ts";

Deno.test("partial multi-device delivery resumes only undelivered endpoints", () => {
  const first = { id: "device-a", endpoint: "https://fcm.googleapis.com/fcm/send/device-a" };
  const second = { id: "device-b", endpoint: "https://fcm.googleapis.com/fcm/send/device-b" };
  const third = { id: "device-c", endpoint: "https://fcm.googleapis.com/fcm/send/device-c" };

  const pending = getPendingPushSubscriptions(
    [first, second, third],
    [first.endpoint, third.endpoint],
  );

  if (pending.length !== 1 || pending[0].id !== "device-b") {
    throw new Error("A retry must target only the device without a delivery checkpoint");
  }
});

Deno.test("all checkpointed devices produce an empty pending delivery set", () => {
  const devices = [
    { endpoint: "https://fcm.googleapis.com/fcm/send/device-a" },
    { endpoint: "https://fcm.googleapis.com/fcm/send/device-b" },
  ];

  const pending = getPendingPushSubscriptions(
    devices,
    devices.map((device) => device.endpoint),
  );

  if (pending.length !== 0) {
    throw new Error("No provider calls should be made after every device is checkpointed");
  }
});

Deno.test("duplicate checkpoint values remain harmless", () => {
  const device = { endpoint: "https://fcm.googleapis.com/fcm/send/device-a" };
  const pending = getPendingPushSubscriptions(
    [device],
    [device.endpoint, device.endpoint],
  );

  if (pending.length !== 0) {
    throw new Error("Duplicate delivery checkpoints must not requeue a device");
  }
});
