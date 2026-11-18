import type { Redis } from 'ioredis'
import {
  GITHUB_HTTP_BUDGET_PER_MINUTE,
  githubHttpBudgetOf,
  githubHttpCeilingOf,
  githubHttpParentOf,
  repoAccessProofSchema,
  type RepoAccessProof,
  type CoordinatorAdapter,
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
local parentBudget = tonumber(ARGV[4])
if parentBudget > 0 and tonumber(redis.call('GET', KEYS[5]) or '0') >= parentBudget then return 0 end
redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], 125000)
if parentBudget > 0 then
  redis.call('INCR', KEYS[5])
  redis.call('PEXPIRE', KEYS[5], 125000)
end
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
    return state.granted || state.deniedUntil > Date.now() ? state : undefined
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
        if held.version > incoming.version or (held.version == incoming.version and held.deniedUntil > tonumber(ARGV[2]) and incoming.granted) then return raw end
      end
      local version = tonumber(redis.call('GET', KEYS[2]) or '0')
      if incoming.granted and version > incoming.version then
        return raw or cjson.encode({version=version, checkedAt=tonumber(ARGV[2]), granted=false, deniedUntil=0, message='Authorization superseded; retrying'})
      end
      if incoming.granted then
        redis.call('SET', KEYS[1], ARGV[1])
      else
        redis.call('SET', KEYS[1], ARGV[1], 'PX', math.max(1, incoming.deniedUntil - tonumber(ARGV[2])))
      end
      return ARGV[1]`,
      2,
      `${this.prefix}authorization:${args.key}`,
      `${this.prefix}authorization-version:${args.key}`,
      JSON.stringify(args.state),
      Date.now(),
    )
    return repoAccessProofSchema.parse(JSON.parse(String(raw)))
  }

  async revokeAuthorization(key: string): Promise<void> {
    await this.client.del(`${this.prefix}authorization:${key}`)
  }

  async revokeAuthorizations(prefix: string): Promise<void> {
    const pattern = `${this.prefix}authorization:${prefix}*`
    let cursor = '0'
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
      cursor = next
      if (keys.length > 0) await this.client.del(...keys)
    } while (cursor !== '0')
  }

  async takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean> {
    const window = `${this.prefix}http:${Math.floor(Date.now() / 60_000)}:${this.credentialOf(identity)}`
    const parent = githubHttpParentOf(identity?.category)
    const result = await this.client.eval(
      BUDGET,
      5,
      window,
      this.cooldownKey(identity),
      `${window}:${identity?.category ?? 'unclassified'}`,
      `${window}:src:${identity?.source ?? 'unattributed'}`,
      `${window}:${parent ?? 'unclassified'}`,
      Date.now(),
      GITHUB_HTTP_BUDGET_PER_MINUTE,
      githubHttpBudgetOf(identity?.category),
      parent === undefined ? 0 : githubHttpCeilingOf(identity?.category),
    )
    return result === 1
  }

  async httpCooldownUntil(identity: GithubRequestIdentity): Promise<number> {
    return Number((await this.client.get(this.cooldownKey(identity))) ?? 0)
  }

  async httpReserveUntil(identity: GithubRequestIdentity): Promise<number> {
    return Number((await this.client.get(this.reserveKey(identity))) ?? 0)
  }

  async holdHttpReserve(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void> {
    await this.client.eval(
      `local held = tonumber(redis.call('GET', KEYS[1]) or '0')
      if tonumber(ARGV[1]) > held then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) end
      return 1`,
      1,
      this.reserveKey(args),
      args.until,
      Math.max(1, args.until - Date.now()),
    )
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

  private credentialOf(identity?: Partial<GithubRequestIdentity>): string {
    return identity?.credentialFingerprint ?? 'unattributed'
  }

  private cooldownKey(identity?: Partial<GithubRequestIdentity>): string {
    return `${this.prefix}blocked:${this.credentialOf(identity)}:${identity?.resource ?? 'core'}`
  }

  private reserveKey(identity?: Partial<GithubRequestIdentity>): string {
    return `${this.prefix}reserve:${this.credentialOf(identity)}:${identity?.resource ?? 'core'}`
  }
}
