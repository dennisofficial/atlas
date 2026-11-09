const MAX_URL_LENGTH = 8192

export enum EUrlRefusal {
  Malformed = 'malformed',
  TooLong = 'too-long',
  UnsupportedScheme = 'unsupported-scheme',
}

export type AcceptedUrl = { ok: true; url: string; host: string }

export type RefusedUrl = { ok: false; refusal: EUrlRefusal; reason: string }

export type UrlVerdict = AcceptedUrl | RefusedUrl

/**
 * The sandbox is the isolation boundary, not the url: the shell beside these tools already reaches
 * every host the sandbox can, so the only url refused here is one that is not a web url at all.
 */
export function acceptUrl(candidate: string): UrlVerdict {
  const trimmed = candidate.trim()
  if (trimmed.length === 0)
    return { ok: false, refusal: EUrlRefusal.Malformed, reason: 'the url is empty' }
  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      refusal: EUrlRefusal.TooLong,
      reason: `the url is ${trimmed.length} characters, above the ${MAX_URL_LENGTH} allowed`,
    }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, refusal: EUrlRefusal.Malformed, reason: `"${trimmed}" is not a url` }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      refusal: EUrlRefusal.UnsupportedScheme,
      reason: `${parsed.protocol.replace(':', '')} urls are not web urls; only http and https are`,
    }
  }

  return { ok: true, url: parsed.toString(), host: parsed.hostname }
}
