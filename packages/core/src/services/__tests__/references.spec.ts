import { describe, expect, it } from 'bun:test'

import {
  EServiceReferenceField,
  interpolateServiceEnv,
  orderDeclaredServices,
  serviceReferencesOf,
} from '../references'

describe('serviceReferencesOf', () => {
  it('finds every reference in any env value', () => {
    expect(
      serviceReferencesOf({
        API: '${services.api.url}/v1',
        TWO: '${services.db.port}:${services.web.publicUrl}',
        PLAIN: 'x',
      }),
    ).toEqual([
      { target: 'api', field: EServiceReferenceField.Url },
      { target: 'db', field: EServiceReferenceField.Port },
      { target: 'web', field: EServiceReferenceField.PublicUrl },
    ])
  })
})

describe('orderDeclaredServices', () => {
  const web = { name: 'web', env: { API: '${services.api.url}' } }
  const api = { name: 'api', env: { DB: '${services.db.port}' } }
  const db = { name: 'db' }

  it('orders dependencies first', () => {
    expect(orderDeclaredServices({ services: [web, api, db] })).toEqual({
      ok: true,
      order: ['db', 'api', 'web'],
    })
  })

  it('keeps declaration order without references', () => {
    expect(orderDeclaredServices({ services: [{ name: 'b' }, { name: 'a' }] })).toEqual({
      ok: true,
      order: ['b', 'a'],
    })
  })

  it('limits the result to the closure of wanted', () => {
    expect(
      orderDeclaredServices({
        services: [web, api, db, { name: 'x' }],
        wanted: ['api'],
      }),
    ).toEqual({
      ok: true,
      order: ['db', 'api'],
    })
  })

  it('rejects a missing target', () => {
    const result = orderDeclaredServices({ services: [web] })
    expect(result).toEqual({
      ok: false,
      problems: [{ name: 'web', detail: 'references undeclared service "api"' }],
    })
  })

  it('rejects a cycle and names it', () => {
    const result = orderDeclaredServices({
      services: [
        { name: 'a', env: { X: '${services.b.url}' } },
        { name: 'b', env: { X: '${services.a.url}' } },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]?.detail).toContain('a -> b -> a')
  })

  it('rejects publicUrl of a service without a portal', () => {
    const result = orderDeclaredServices({
      services: [{ name: 'web', env: { U: '${services.api.publicUrl}' } }, { name: 'api' }],
    })
    expect(result.ok).toBe(false)
    expect(
      orderDeclaredServices({
        services: [
          { name: 'web', env: { U: '${services.api.publicUrl}' } },
          { name: 'api', portal: true },
        ],
      }).ok,
    ).toBe(true)
  })
})

describe('interpolateServiceEnv', () => {
  it('replaces references with resolved values', () => {
    expect(
      interpolateServiceEnv({
        env: {
          A: '${services.api.url}/x',
          B: '${services.api.port}',
          C: '${services.api.publicUrl}',
          D: 'keep',
        },
        resolved: {
          api: {
            url: 'http://127.0.0.1:20001',
            publicUrl: 'https://p.dev',
            port: 20_001,
          },
        },
      }),
    ).toEqual({
      A: 'http://127.0.0.1:20001/x',
      B: '20001',
      C: 'https://p.dev',
      D: 'keep',
    })
  })
})
