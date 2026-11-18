const FALLBACK_RETRY_SECONDS = 60
const SECONDARY_LIMIT_MARKER = 'secondary rate limit'
const BODY_PROBE_CHARS = 4_096
const HTTP_FORBIDDEN = 403

const secondsHeader = (headers: Headers, name: string): number | null => {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

const retryAfterOf = (headers: Headers): number | null => {
  const retryAfter = secondsHeader(headers, 'retry-after')
  return retryAfter === null ? null : Math.max(1, Math.ceil(retryAfter))
}

// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit
export function rateLimitOf(response: Response): { retryAfterSeconds: number } | null {
  const retryAfter = retryAfterOf(response.headers)
  const remaining = secondsHeader(response.headers, 'x-ratelimit-remaining')
  const exhausted = remaining === 0
  const limited =
    response.status === 429 || (response.status === 403 && (exhausted || retryAfter !== null))
  if (!limited) return null

  if (retryAfter !== null) return { retryAfterSeconds: retryAfter }
  const reset = secondsHeader(response.headers, 'x-ratelimit-reset')
  if (exhausted && reset !== null) {
    return {
      retryAfterSeconds: Math.max(1, Math.ceil(reset - Date.now() / 1_000)),
    }
  }
  return { retryAfterSeconds: FALLBACK_RETRY_SECONDS }
}

// https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#handle-secondary-rate-limits
async function mentionsSecondaryLimit(response: Response): Promise<boolean> {
  if (response.status !== HTTP_FORBIDDEN) return false
  const remaining = secondsHeader(response.headers, 'x-ratelimit-remaining')
  if (remaining !== null && remaining <= 0) return false
  try {
    const body = await response.clone().text()
    return body.slice(0, BODY_PROBE_CHARS).toLowerCase().includes(SECONDARY_LIMIT_MARKER)
  } catch {
    return false
  }
}

export async function rateLimitOfResponse(
  response: Response,
): Promise<{ retryAfterSeconds: number } | null> {
  const header = rateLimitOf(response)
  if (header !== null) return header
  if (!(await mentionsSecondaryLimit(response))) return null
  return { retryAfterSeconds: retryAfterOf(response.headers) ?? FALLBACK_RETRY_SECONDS }
}
