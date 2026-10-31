const FALLBACK_RETRY_SECONDS = 60

const secondsHeader = (headers: Headers, name: string): number | null => {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit
export function rateLimitOf(response: Response): { retryAfterSeconds: number } | null {
  const retryAfter = secondsHeader(response.headers, 'retry-after')
  const remaining = secondsHeader(response.headers, 'x-ratelimit-remaining')
  const exhausted = remaining === 0
  const limited =
    response.status === 429 || (response.status === 403 && (exhausted || retryAfter !== null))
  if (!limited) return null

  if (retryAfter !== null) return { retryAfterSeconds: Math.max(1, Math.ceil(retryAfter)) }
  const reset = secondsHeader(response.headers, 'x-ratelimit-reset')
  if (exhausted && reset !== null) {
    return {
      retryAfterSeconds: Math.max(1, Math.ceil(reset - Date.now() / 1_000)),
    }
  }
  return { retryAfterSeconds: FALLBACK_RETRY_SECONDS }
}
