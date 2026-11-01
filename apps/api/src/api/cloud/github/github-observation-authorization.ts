import type { ObservationAuthorization } from './github-observation.types'

export const AUTHORIZATION_CHECKS_PER_ACQUIRE = 6
export const authorizationKey = (args: {
  userId: string
  fingerprint: string
  repo: string
}): string => `${args.userId}:${args.repo}:${args.fingerprint}`
export const authorizationAllows = (state: ObservationAuthorization | undefined): boolean =>
  state !== undefined && state.deniedUntil <= Date.now() && state.authorizedUntil > Date.now()

export class GithubAuthorizationWork {
  private readonly cursors = new Map<string, number>()

  ordered(args: { key: string; repos: string[] }): string[] {
    const repos = [...args.repos].sort()
    if (repos.length === 0) return []
    const offset = (this.cursors.get(args.key) ?? 0) % repos.length
    return [...repos.slice(offset), ...repos.slice(0, offset)]
  }

  advance(args: { key: string; repo: string; repos: string[] }): void {
    this.cursors.set(args.key, [...args.repos].sort().indexOf(args.repo) + 1)
    if (this.cursors.size <= 512) return
    const oldest = this.cursors.keys().next().value
    if (oldest !== undefined) this.cursors.delete(oldest)
  }
}
