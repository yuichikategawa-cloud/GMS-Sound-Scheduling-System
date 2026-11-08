export type PushFailureClassification = {
  statusCode: number;
  permanent: boolean;
  message: string;
};

/**
 * Browser push providers use 404/410 to indicate an expired or gone
 * subscription. Other HTTP failures (including 429/5xx) and transport
 * failures are retryable; the queue's bounded backoff prevents infinite work.
 */
export function classifyPushFailure(error: unknown): PushFailureClassification {
  const candidate = error as {
    statusCode?: unknown;
    body?: unknown;
    message?: unknown;
  } | null;
  const rawStatus = Number(candidate?.statusCode ?? 0);
  const statusCode = Number.isFinite(rawStatus) && rawStatus > 0
    ? Math.floor(rawStatus)
    : 0;
  const rawMessage = candidate?.body ?? candidate?.message ?? error;
  const message = String(rawMessage ?? "Push provider request failed").slice(0, 1000);

  return {
    statusCode,
    permanent: statusCode === 404 || statusCode === 410,
    message,
  };
}
