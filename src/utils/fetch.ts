/**
 * fetch() wrapper that throws on non-2xx and enforces a timeout.
 * Caller-supplied signal in init is overwritten by the internal abort controller.
 * All callers use the default timeout; do not pass a signal via init.
 */
export async function fetchWithTimeout(
  input: RequestInfo,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(input, { ...init, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return resp;
  } finally {
    clearTimeout(id);
  }
}
