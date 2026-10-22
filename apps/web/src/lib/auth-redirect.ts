export function safeNextPath(raw: string | null): string | null {
  if (raw === null || !raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}

export enum ESignInContext {
  Default = 'default',
  Device = 'device',
  Invite = 'invite',
}

export function signInContextOf(next: string | null): ESignInContext {
  if (next === null) return ESignInContext.Default
  if (next.startsWith('/device')) return ESignInContext.Device
  if (next.startsWith('/invite/')) return ESignInContext.Invite
  return ESignInContext.Default
}

export const withNext = (args: { path: string; next: string | null }): string =>
  args.next === null ? args.path : `${args.path}?next=${encodeURIComponent(args.next)}`
