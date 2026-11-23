import { describe, expect, it } from 'bun:test'

import { type CorsRule, corsUrlOf, problemsOf, type R2CorsConfig, sameRules } from '../r2-cors'

const ruleOf = (args: { origins: string[]; methods?: string[] }): CorsRule => ({
  allowed: { origins: args.origins, methods: args.methods ?? ['GET', 'HEAD'] },
  maxAgeSeconds: 3600,
})

const configOf = (rule: CorsRule): R2CorsConfig => ({
  accountId: 'account',
  buckets: [{ bucket: 'atlas-artifacts', rules: [rule] }],
})

describe('problemsOf', () => {
  it('accepts the committed policy', async () => {
    const committed = (await Bun.file(
      new URL('../../infra/r2/cors.json', import.meta.url),
    ).json()) as R2CorsConfig
    expect(problemsOf(committed)).toEqual([])
  })

  it('refuses an origin wildcard for everyone', () => {
    expect(problemsOf(configOf(ruleOf({ origins: ['*'] })))).toEqual([
      'atlas-artifacts: origin * is not one scheme://host with at most one *',
    ])
  })

  it('refuses an origin with a path or two wildcards', () => {
    const rule = ruleOf({ origins: ['https://byatlas.io/', 'https://*-*.byatlas.dev'] })
    expect(problemsOf(configOf(rule))).toHaveLength(2)
  })

  it('refuses a write method', () => {
    const rule = ruleOf({ origins: ['https://byatlas.io'], methods: ['GET', 'PUT'] })
    expect(problemsOf(configOf(rule))).toEqual(['atlas-artifacts: method PUT is not a read'])
  })
})

describe('sameRules', () => {
  it('ignores the order of origins and methods', () => {
    const wanted = [ruleOf({ origins: ['https://a.io', 'https://b.io'] })]
    const live = [ruleOf({ origins: ['https://b.io', 'https://a.io'], methods: ['HEAD', 'GET'] })]
    expect(sameRules({ wanted, live })).toBe(true)
  })

  it('sees a missing origin as drift', () => {
    const wanted = [ruleOf({ origins: ['https://a.io', 'https://b.io'] })]
    const live = [ruleOf({ origins: ['https://a.io'] })]
    expect(sameRules({ wanted, live })).toBe(false)
  })
})

it('addresses the bucket cors endpoint of the account', () => {
  expect(corsUrlOf({ accountId: 'acc', bucket: 'atlas-artifacts' })).toBe(
    'https://api.cloudflare.com/client/v4/accounts/acc/r2/buckets/atlas-artifacts/cors',
  )
})
