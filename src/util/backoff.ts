/**
 * Exponential backoff with ±20% jitter.
 *
 * @param attempt 1-based reconnect attempt number.
 * @param baseDelay base delay in ms (attempt 1 ≈ baseDelay).
 * @param maxDelay cap applied before jitter.
 */
export function backoffDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponential = baseDelay * 2 ** (attempt - 1);
  const capped = Math.min(exponential, maxDelay);
  const jitter = capped * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}
