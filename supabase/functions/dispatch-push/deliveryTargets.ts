export type PushEndpointTarget = { endpoint: string };

/**
 * Return only endpoints that have not already been checkpointed for this
 * notification. This makes retries resume partial multi-device delivery
 * without resending to endpoints already confirmed by the provider.
 */
export function getPendingPushSubscriptions<T extends PushEndpointTarget>(
  subscriptions: readonly T[],
  deliveredEndpoints: readonly string[] = [],
): T[] {
  const delivered = new Set(deliveredEndpoints);
  return subscriptions.filter((subscription) => !delivered.has(subscription.endpoint));
}
