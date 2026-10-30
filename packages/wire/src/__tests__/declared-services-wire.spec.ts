import { describe, expect, it } from 'bun:test'

import {
  declaredServicesViewWireSchema,
  type DeclaredServicesViewWire,
  ensureDeclaredServicesParamsSchema,
  ensureDeclaredServicesReplySchema,
  restartServiceReplySchema,
  serviceSnapshotWireSchema,
} from '../index'

describe('the declared-services wire', () => {
  it('round-trips a view with links and a rejection', () => {
    const view: DeclaredServicesViewWire = {
      services: [
        {
          name: 'web',
          state: 'running',
          serviceId: 'svc-1',
          port: 3000,
          url: 'https://p.example',
          links: [{ url: 'https://p.example', title: 'Web' }],
        },
        { name: 'api', state: 'crash-looping', links: [], reason: 'exited 1' },
      ],
      rejections: [{ detail: 'bad port' }],
    }

    expect(declaredServicesViewWireSchema.parse(view)).toEqual(view)
  })

  it('refuses a state outside the declared set', () => {
    const parsed = declaredServicesViewWireSchema.safeParse({
      services: [{ name: 'web', state: 'paused', links: [] }],
      rejections: [],
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts ensure params with or without names and refuses empty names', () => {
    expect(ensureDeclaredServicesParamsSchema.safeParse({}).success).toBe(true)
    expect(ensureDeclaredServicesParamsSchema.safeParse({ names: ['web'] }).success).toBe(true)
    expect(ensureDeclaredServicesParamsSchema.safeParse({ names: [''] }).success).toBe(false)
  })

  it('parses both arms of the ensure and restart replies', () => {
    expect(
      ensureDeclaredServicesReplySchema.parse({
        ok: true,
        results: [{ name: 'web', status: 'started', links: [], ready: true }],
      }),
    ).toMatchObject({ ok: true })
    expect(restartServiceReplySchema.parse({ ok: false, reason: 'gone' })).toEqual({
      ok: false,
      reason: 'gone',
    })
  })

  it('carries a service name and port on the roster snapshot', () => {
    const snapshot = serviceSnapshotWireSchema.parse({
      serviceId: 'svc-1',
      command: 'bun dev',
      description: 'd',
      status: 'running',
      logPath: '/l',
      startedAt: '2026-10-30T00:00:00.000Z',
      name: 'web',
      port: 3000,
    })

    expect(snapshot).toMatchObject({ name: 'web', port: 3000 })
  })
})
