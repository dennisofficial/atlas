import { describe, expect, it } from 'bun:test'

import { toThreadId } from '../../events/ids'
import { serviceDeclarationSchema, servicesFileSchema } from '../declaration'
import { serviceEnv } from '../env'
import { deriveServicePort, nextServicePort } from '../port'
import { EServiceType } from '../service-type'

const THREAD = toThreadId('thread-1')

describe('serviceDeclarationSchema', () => {
  it('accepts a full declaration', () => {
    const parsed = serviceDeclarationSchema.safeParse({
      command: 'bun dev',
      cwd: 'apps/web',
      port: 3000,
      health: '/healthz',
      env: { NODE_ENV: 'development' },
      portal: { title: 'Web' },
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts portal: true and rejects portal: false', () => {
    expect(serviceDeclarationSchema.safeParse({ command: 'x', portal: true }).success).toBe(true)
    expect(serviceDeclarationSchema.safeParse({ command: 'x', portal: false }).success).toBe(false)
  })

  it('rejects reserved env keys', () => {
    for (const key of ['PORT', 'PUBLIC_URL', 'ATLAS_THREAD_ID']) {
      const parsed = serviceDeclarationSchema.safeParse({
        command: 'x',
        env: { [key]: '1' },
      })
      expect(parsed.success).toBe(false)
    }
  })

  it('rejects unknown fields, a missing command and a health path without a slash', () => {
    expect(serviceDeclarationSchema.safeParse({ command: 'x', nope: 1 }).success).toBe(false)
    expect(serviceDeclarationSchema.safeParse({}).success).toBe(false)
    expect(serviceDeclarationSchema.safeParse({ command: 'x', health: 'up' }).success).toBe(false)
  })

  it('accepts each service type and keeps it on the parsed declaration', () => {
    for (const type of Object.values(EServiceType)) {
      const parsed = serviceDeclarationSchema.safeParse({ command: 'x', type })
      expect(parsed.success).toBe(true)
      expect(parsed.data?.type).toBe(type)
    }
  })

  it('rejects an unknown service type and leaves an absent one untyped', () => {
    expect(serviceDeclarationSchema.safeParse({ command: 'x', type: 'mobile' }).success).toBe(false)
    const parsed = serviceDeclarationSchema.safeParse({ command: 'x' })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.type).toBeUndefined()
  })

  it('requires a services map at the file level', () => {
    expect(servicesFileSchema.safeParse({ services: { web: {} } }).success).toBe(true)
    expect(servicesFileSchema.safeParse({ web: {} }).success).toBe(false)
  })
})

describe('deriveServicePort', () => {
  it('is stable for one name and stays in 20000-29999', () => {
    const port = deriveServicePort({ name: 'web' })
    expect(deriveServicePort({ name: 'web' })).toBe(port)
    expect(port).toBeGreaterThanOrEqual(20_000)
    expect(port).toBeLessThanOrEqual(29_999)
  })

  it('spreads names across ports', () => {
    const ports = new Set(
      ['web', 'api', 'db', 'cache', 'worker'].map((name) => deriveServicePort({ name })),
    )
    expect(ports.size).toBeGreaterThan(1)
  })
})

describe('nextServicePort', () => {
  it('steps by one and wraps inside the range', () => {
    expect(nextServicePort({ port: 20_000 })).toBe(20_001)
    expect(nextServicePort({ port: 29_999 })).toBe(20_000)
  })
})

describe('serviceEnv', () => {
  it('sets PORT and the thread id without a portal', () => {
    expect(serviceEnv({ port: 205, threadId: THREAD })).toEqual({
      PORT: '205',
      ATLAS_THREAD_ID: 'thread-1',
    })
  })

  it('adds PUBLIC_URL and the Vite allowed host for a portal', () => {
    expect(
      serviceEnv({
        port: 3000,
        threadId: THREAD,
        publicUrl: 'https://3000-abc.byatlas.dev',
      }),
    ).toEqual({
      PORT: '3000',
      ATLAS_THREAD_ID: 'thread-1',
      PUBLIC_URL: 'https://3000-abc.byatlas.dev',
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: '3000-abc.byatlas.dev',
    })
  })
})
