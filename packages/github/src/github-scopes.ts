import { REQUESTED_SCOPES } from './github-device-client'

// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
// The device-flow token response returns scope comma-separated, not space-separated.
export function splitScopes(scope: string): string[] {
  return scope.split(/[\s,]+/).filter((entry) => entry.length > 0)
}

// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
// GitHub drops implied scopes from the granted string: admin:X covers write:X, which covers read:X.
const IMPLIED_BY: Record<string, string[]> = {
  'read:': ['write:', 'admin:'],
  'write:': ['admin:'],
}

function impliersOf(wanted: string): string[] {
  for (const [prefix, stronger] of Object.entries(IMPLIED_BY)) {
    if (!wanted.startsWith(prefix)) continue
    const name = wanted.slice(prefix.length)
    return stronger.map((strongerPrefix) => `${strongerPrefix}${name}`)
  }
  return []
}

export function scopeSatisfied(args: { held: ReadonlySet<string>; wanted: string }): boolean {
  if (args.held.has(args.wanted)) return true
  return impliersOf(args.wanted).some((scope) => args.held.has(scope))
}

export function missingScopesOf(granted: string): string[] {
  const held = new Set(splitScopes(granted))
  return splitScopes(REQUESTED_SCOPES).filter((wanted) => !scopeSatisfied({ held, wanted }))
}

export const SSH_SIGNING_SCOPE = 'admin:ssh_signing_key'

export function hasSigningScope(granted: string): boolean {
  return scopeSatisfied({ held: new Set(splitScopes(granted)), wanted: SSH_SIGNING_SCOPE })
}
