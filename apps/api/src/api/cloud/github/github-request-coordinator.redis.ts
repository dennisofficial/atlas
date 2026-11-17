import type { Redis } from 'ioredis'
import {
  GITHUB_HTTP_BUDGET_PER_MINUTE,
  GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE,
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE,
  EGithubHttpCategory,
  repoAccessProofSchema,
  type RepoAccessProof,
  type CoordinatorAdapter,
  type RefreshAttempt,
  type GithubRequestIdentity,
} from './github-request-coordinator.types'

const PREFIX = 'atlas:github:coordinator:v1:'
const BUDGET = `
local blocked = tonumber(redis.call('GET', KEYS[2]) or '0')
if blocked > tonumber(ARGV[1]) then return 0 end
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
if spent >= tonumber(ARGV[2]) then return 0 end
local category = tonumber(redis.call('GET', KEYS[3]) or '0')
if category >= tonumber(ARGV[3]) then return 0 end
redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], 125000)
redis.call('INCR', KEYS[4])
redis.call('PEXPIRE', KEYS[4], 125000)
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], 125000)
return 1
`

export class RedisCoordinatorAdapter implements CoordinatorAdapter {
  constructor(
    private readonly client: Redis,
    private readonly prefix = PREFIX,
  ) {}

  async readAuthorization(key: string): Promise<RepoAccessProof | undefined> {
    const raw = await this.client.get(`${this.prefix}authorization:${key}`)
    if (raw === null) return undefined
    const state = repoAccessProofSchema.parse(JSON.parse(raw))
    return Math.max(state.authorizedUntil, state.deniedUntil) > Date.now() ? state : undefined
  }

  async beginAuthorization(key: string): Promise<number> {
    return Number(
      await this.client.eval(
        `local version = redis.call('INCR', KEYS[1])
      redis.call('PEXPIRE', KEYS[1], 1200000)
      return version`,
        1,
        `${this.prefix}authorization-version:${key}`,
      ),
    )
  }

  async writeAuthorization(args: {
    key: string
    state: RepoAccessProof
  }): Promise<RepoAccessProof> {
    const raw = await this.client.eval(
      `
      local incoming = cjson.decode(ARGV[1])
      local raw = redis.call('GET', KEYS[1])
      if raw then
        local held = cjson.decode(raw)
        if held.version > incoming.version or (held.version == incoming.version and held.deniedUntil > tonumber(ARGV[3]) and incoming.authorizedUntil > 0) then return raw end
      end
      local version = tonumber(redis.call('GET', KEYS[2]) or '0')
      if incoming.authorizedUntil > 0 and version > incoming.version then
        return raw or cjson.encode({version=version, checkedAt=tonumber(ARGV[3]), authorizedUntil=0, deniedUntil=0, message='Authorization superseded; retrying'})
      end
      redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
      return ARGV[1]`,
      2,
      `${this.prefix}authorization:${args.key}`,
      `${this.prefix}authorization-version:${args.key}`,
      JSON.stringify(args.state),
      Math.max(1, Math.max(args.state.authorizedUntil, args.state.deniedUntil) - Date.now()),
      Date.now(),
    )
    return repoAccessProofSchema.parse(JSON.parse(String(raw)))
  }

  async takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean> {
    const minute = Math.floor(Date.now() / 60_000)
    const result = await this.client.eval(
      BUDGET,
      4,
      `${this.prefix}http:${minute}`,
      this.cooldownKey(identity),
      `${this.prefix}http:${minute}:${identity?.category ?? 'unclassified'}`,
      `${this.prefix}http:${minute}:src:${identity?.source ?? 'unattributed'}`,
      Date.now(),
      GITHUB_HTTP_BUDGET_PER_MINUTE,
      identity?.category === EGithubHttpCategory.Authorization
        ? GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE
        : identity?.category === EGithubHttpCategory.Refresh
          ? GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE
          : GITHUB_HTTP_BUDGET_PER_MINUTE,
    )
    return result === 1
  }

  async httpCooldownUntil(identity: GithubRequestIdentity): Promise<number> {
    return Number((await this.client.get(this.cooldownKey(identity))) ?? 0)
  }

  async blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void> {
    await this.client.eval(
      `local held = tonumber(redis.call('GET', KEYS[1]) or '0')
      if tonumber(ARGV[1]) > held then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) end
      return 1`,
      1,
      this.cooldownKey(args),
      args.until,
      Math.max(1, args.until - Date.now()),
    )
  }

  private cooldownKey(identity?: Partial<GithubRequestIdentity>): string {
    return `${this.prefix}blocked:${identity?.credentialFingerprint ?? 'unattributed'}:${identity?.resource ?? 'core'}`
  }

  async attempt(key: string): Promise<RefreshAttempt> {
    const raw = await this.client.get(`${this.prefix}attempt:${key}`)
    if (raw === null) return { nextAttemptAt: 0, failures: 0 }
    const parsed = JSON.parse(raw) as RefreshAttempt
    return { nextAttemptAt: parsed.nextAttemptAt, failures: parsed.failures }
  }

  async recordAttempt(args: { key: string; failed: boolean }): Promise<void> {
    const prior = await this.attempt(args.key)
    const failures = args.failed ? Math.min(prior.failures + 1, 8) : 0
    const nextAttemptAt =
      Date.now() + (args.failed ? Math.min(30_000 * 2 ** failures, 600_000) : 30_000)
    await this.client.set(
      `${this.prefix}attempt:${args.key}`,
      JSON.stringify({ nextAttemptAt, failures }),
      'PX',
      1_200_000,
    )
  }
}
