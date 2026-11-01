import type { Redis } from 'ioredis'
import { prIdentity } from './github-linked-prs'
import {
  GITHUB_HTTP_BUDGET_PER_MINUTE,
  GITHUB_AUTH_HTTP_BUDGET_PER_MINUTE,
  GITHUB_REFRESH_HTTP_BUDGET_PER_MINUTE,
  EGithubHttpCategory,
  observationAuthorizationSchema,
  type ObservationAuthorization,
  observationLeaseSchema,
  type ObservationAdapter,
  type ObservationAttempt,
  type ObservationLease,
  type GithubRequestIdentity,
} from './github-observation.types'

const PREFIX = 'atlas:github:observe:v1:'
const WRITE = `
local function refreshIndex(key)
  local held = redis.call('PTTL', key)
  redis.call('PEXPIRE', key, math.max(held, tonumber(ARGV[2]), 120000))
end
local old = redis.call('GET', KEYS[1])
if old then
  local lease = cjson.decode(old)
  for _, pr in ipairs(lease.keys) do
    redis.call('ZREM', ARGV[3] .. 'repo:' .. pr.repoFullName, lease.id)
    redis.call('ZREM', ARGV[3] .. 'pr:' .. pr.repoFullName .. '#' .. pr.prNumber, lease.id)
    redis.call('ZREMRANGEBYSCORE', ARGV[3] .. 'repo:' .. pr.repoFullName, '-inf', ARGV[4])
    redis.call('ZREMRANGEBYSCORE', ARGV[3] .. 'pr:' .. pr.repoFullName .. '#' .. pr.prNumber, '-inf', ARGV[4])
  end
end
local lease = cjson.decode(ARGV[1])
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[4])
redis.call('ZADD', KEYS[2], lease.expiresAt, lease.id)
refreshIndex(KEYS[2])
for _, pr in ipairs(lease.keys) do
  for _, key in ipairs({ARGV[3] .. 'repo:' .. pr.repoFullName, ARGV[3] .. 'pr:' .. pr.repoFullName .. '#' .. pr.prNumber}) do
    redis.call('ZREMRANGEBYSCORE', key, '-inf', ARGV[4])
    redis.call('ZADD', key, lease.expiresAt, lease.id)
    refreshIndex(key)
  end
end
return 1
`
const REMOVE = `
local old = redis.call('GET', KEYS[1])
if old then
  local lease = cjson.decode(old)
  for _, pr in ipairs(lease.keys) do
    redis.call('ZREM', ARGV[2] .. 'repo:' .. pr.repoFullName, lease.id)
    redis.call('ZREM', ARGV[2] .. 'pr:' .. pr.repoFullName .. '#' .. pr.prNumber, lease.id)
  end
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`
const BUDGET = `
local blocked = tonumber(redis.call('GET', KEYS[2]) or '0')
if blocked > tonumber(ARGV[1]) then return 0 end
local spent = tonumber(redis.call('GET', KEYS[1]) or '0')
if spent >= tonumber(ARGV[2]) then return 0 end
local category = tonumber(redis.call('GET', KEYS[3]) or '0')
if category >= tonumber(ARGV[3]) then return 0 end
redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], 125000)
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], 125000)
return 1
`

export class RedisObservationAdapter implements ObservationAdapter {
  constructor(
    private readonly client: Redis,
    private readonly prefix = PREFIX,
  ) {}

  async readAuthorization(key: string): Promise<ObservationAuthorization | undefined> {
    const raw = await this.client.get(`${this.prefix}authorization:${key}`)
    if (raw === null) return undefined
    const state = observationAuthorizationSchema.parse(JSON.parse(raw))
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
    state: ObservationAuthorization
  }): Promise<ObservationAuthorization> {
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
    return observationAuthorizationSchema.parse(JSON.parse(String(raw)))
  }

  async read(id: string): Promise<ObservationLease | undefined> {
    const raw = await this.client.get(`${this.prefix}lease:${id}`)
    if (raw === null) return undefined
    const lease = observationLeaseSchema.parse(JSON.parse(raw))
    return lease.expiresAt > Date.now() ? lease : undefined
  }

  async write(lease: ObservationLease): Promise<void> {
    await this.client.eval(
      WRITE,
      2,
      `${this.prefix}lease:${lease.id}`,
      `${this.prefix}active`,
      JSON.stringify(lease),
      Math.max(1, lease.expiresAt - Date.now()),
      this.prefix,
      Date.now(),
    )
  }

  async remove(id: string): Promise<void> {
    await this.client.eval(
      REMOVE,
      2,
      `${this.prefix}lease:${id}`,
      `${this.prefix}active`,
      id,
      this.prefix,
    )
  }

  async entries(filter?: { repoFullName: string; prNumber?: number }): Promise<ObservationLease[]> {
    const index =
      filter === undefined
        ? 'active'
        : filter.prNumber === undefined
          ? `repo:${filter.repoFullName}`
          : `pr:${prIdentity({ ...filter, prNumber: filter.prNumber })}`
    const key = `${this.prefix}${index}`
    await this.client.zremrangebyscore(key, '-inf', String(Date.now()))
    if (filter !== undefined) return this.recipientEntries(key)
    const count = await this.client.zcard(key)
    if (count === 0) return []
    let offset = 0
    if (count > 128) {
      const cursor = await this.client.incrby(`${this.prefix}cursor`, 128)
      await this.client.pexpire(`${this.prefix}cursor`, 120_000)
      offset = (cursor - 128) % count
    }
    const ids = await this.client.zrange(key, String(offset), String(offset + 127))
    if (count > 128 && ids.length < 128)
      ids.push(...(await this.client.zrange(key, '0', String(127 - ids.length))))
    const leases = await Promise.all(ids.map((id) => this.read(id)))
    return leases.filter((lease): lease is ObservationLease => lease !== undefined)
  }

  private async recipientEntries(key: string): Promise<ObservationLease[]> {
    const leases = new Map<string, ObservationLease>()
    let cursor = '0'
    do {
      const page = await this.client.zscan(key, cursor, 'COUNT', '128')
      cursor = page[0]
      const ids = page[1].filter((_, index) => index % 2 === 0)
      for (const lease of await Promise.all(ids.map((id) => this.read(id)))) {
        if (lease !== undefined) leases.set(lease.id, lease)
      }
    } while (cursor !== '0')
    return [...leases.values()]
  }

  async takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean> {
    const minute = Math.floor(Date.now() / 60_000)
    const result = await this.client.eval(
      BUDGET,
      3,
      `${this.prefix}http:${minute}`,
      this.cooldownKey(identity),
      `${this.prefix}http:${minute}:${identity?.category ?? 'unclassified'}`,
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

  async attempt(key: string): Promise<ObservationAttempt> {
    const raw = await this.client.get(`${this.prefix}attempt:${key}`)
    if (raw === null) return { nextAttemptAt: 0, failures: 0 }
    const parsed = JSON.parse(raw) as ObservationAttempt
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
