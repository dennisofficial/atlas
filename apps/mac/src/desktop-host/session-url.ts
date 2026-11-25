export const SESSION_MARKER = 'ATLAS_URL='
export const HTTP_ORIGIN_MARKER = 'ATLAS_HTTP_ORIGIN='
export const CERT_MARKER = 'ATLAS_CERT='

export function sessionUrlOf({ origin, secret }: { origin: string; secret: string }): string {
  return `${origin}/desktop/session?secret=${secret}`
}
