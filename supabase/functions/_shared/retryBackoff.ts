const BASE_RETRY_SECONDS = 30;
const MAX_RETRY_SECONDS = 15 * 60;

export function retryDelaySeconds(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(Number.isFinite(attempts) ? attempts : 1));
  return Math.min(BASE_RETRY_SECONDS * (2 ** (safeAttempts - 1)), MAX_RETRY_SECONDS);
}
