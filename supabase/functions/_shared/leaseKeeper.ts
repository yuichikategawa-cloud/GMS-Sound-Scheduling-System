export type LeaseRenewal = () => Promise<boolean>;

export type LeaseKeeper = {
  renewNow: () => Promise<boolean>;
  ownsLease: () => boolean;
  stop: () => Promise<void>;
};

/**
 * Renews a claimed queue-row lease while one notification is being processed.
 * Renewal failures fail closed: the worker must stop sending and must not write
 * to the queue using a claim it can no longer prove it owns.
 */
export function startLeaseKeeper(
  renewLease: LeaseRenewal,
  intervalMs = 45_000,
): LeaseKeeper {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) {
    throw new RangeError("Lease renewal interval must be a positive number.");
  }

  let stopped = false;
  let lost = false;
  let pendingRenewal: Promise<boolean> | null = null;

  const renewNow = async (): Promise<boolean> => {
    if (stopped || lost) return false;
    if (pendingRenewal) return pendingRenewal;

    pendingRenewal = (async () => {
      try {
        const renewed = await renewLease();
        if (!renewed) lost = true;
        return renewed;
      } catch {
        lost = true;
        return false;
      }
    })();

    try {
      return await pendingRenewal;
    } finally {
      pendingRenewal = null;
    }
  };

  const timer = setInterval(() => {
    void renewNow();
  }, intervalMs);

  return {
    renewNow,
    ownsLease: () => !stopped && !lost,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (pendingRenewal) await pendingRenewal;
    },
  };
}
