export const SESSION_MARKER = 'ATLAS_URL='

export function sessionUrlOf({ origin, secret }: { origin: string; secret: string }): string {
  return `${origin}/desktop/session?secret=${secret}`
}
