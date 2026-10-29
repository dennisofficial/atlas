import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { seedUsers } from '../../../../test/session-seed'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import {
  CloudflareRecordExistsError,
  type CloudflareTunnelClient,
} from './cloudflare-tunnel.client'
import { PreviewTunnelService } from './preview-tunnel.service'

const HEX_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'

describe('PreviewTunnelService', () => {
  useTestDatabase()
  let created = 0
  const cloudflare = {
    createTunnel: vi.fn(async (_args: { name: string }) => {
      created += 1
      return { id: `tun-${created}`, token: `tok-${created}` }
    }),
    putIngress: vi.fn(async (_args: { tunnelId: string; rules: unknown[] }) => undefined),
    createCname: vi.fn(async (args: { hostname: string; tunnelId: string }) => ({
      id: `rec-${args.hostname}`,
    })),
    findDnsRecord: vi.fn(
      async (_args: { hostname: string }): Promise<{ id: string; content: string } | undefined> =>
        undefined,
    ),
    repointCname: vi.fn(
      async (_args: { recordId: string; hostname: string; tunnelId: string }) => undefined,
    ),
    deleteDnsRecord: vi.fn(async (_args: { recordId: string }) => undefined),
    deleteTunnel: vi.fn(async (_args: { tunnelId: string }) => undefined),
  }
  const cipher = new SecretCipherService(new EnvService({ SECRETS_ENCRYPTION_KEY: HEX_KEY }))
  const service = new PreviewTunnelService(
    new EnvService({ PREVIEW_DOMAIN: 'byatlas.dev' }),
    cipher,
    cloudflare as unknown as CloudflareTunnelClient,
  )

  beforeEach(async () => {
    created = 0
    for (const mock of Object.values(cloudflare)) mock.mockClear()
    await seedUsers('usr-1', 'usr-2')
  })

  it('creates tunnel, cname and ingress on first expose', async () => {
    const reply = await service.expose({
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })

    expect(reply.tunnelToken).toBe('tok-1')
    expect(reply.url).toMatch(/^https:\/\/3000-[0-9a-z]{10}\.byatlas\.dev$/)
    expect(cloudflare.createTunnel.mock.calls[0]?.[0].name).toMatch(/^atlas-thr-1-[0-9a-z]{6}$/)
    expect(cloudflare.createCname).toHaveBeenCalledTimes(1)
    expect(cloudflare.putIngress).toHaveBeenCalledWith({
      tunnelId: 'tun-1',
      rules: [{ hostname: new URL(reply.url).hostname, port: 3000 }],
    })
    const row = await db.orm.public.PreviewTunnel.where({
      threadId: 'thr-1',
    }).first()
    expect(row?.sealedTunnelToken).not.toContain('tok-1')
  })

  it('answers a repeated port without calling cloudflare', async () => {
    const first = await service.expose({
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    for (const mock of Object.values(cloudflare)) mock.mockClear()

    const second = await service.expose({
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })

    expect(second).toEqual(first)
    for (const mock of Object.values(cloudflare)) expect(mock).not.toHaveBeenCalled()
  })

  it('puts both rules when a second port is exposed and shares the label', async () => {
    const first = await service.expose({
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    const second = await service.expose({
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 4000,
    })

    expect(cloudflare.createTunnel).toHaveBeenCalledTimes(1)
    const rules = cloudflare.putIngress.mock.calls.at(-1)?.[0].rules
    expect(rules).toHaveLength(2)
    expect(first.url.split('-')[1]).toBe(second.url.split('-')[1])
  })

  it('serialises concurrent exposes of one thread onto one tunnel', async () => {
    await Promise.all([
      service.expose({ threadId: 'thr-1', userId: 'usr-1', port: 3000 }),
      service.expose({ threadId: 'thr-1', userId: 'usr-1', port: 3000 }),
      service.expose({ threadId: 'thr-1', userId: 'usr-1', port: 4000 }),
    ])

    expect(cloudflare.createTunnel).toHaveBeenCalledTimes(1)
    expect(await db.orm.public.PreviewRoute.all()).toHaveLength(2)
  })

  it('tears down dns records, tunnel and rows, and is a no-op when absent', async () => {
    await service.expose({ threadId: 'thr-1', userId: 'usr-1', port: 3000 })
    await service.expose({ threadId: 'thr-1', userId: 'usr-1', port: 4000 })

    await service.teardown({ threadId: 'thr-1' })

    expect(cloudflare.deleteDnsRecord).toHaveBeenCalledTimes(2)
    expect(cloudflare.deleteTunnel).toHaveBeenCalledWith({ tunnelId: 'tun-1' })
    expect(await db.orm.public.PreviewTunnel.all()).toEqual([])
    expect(await db.orm.public.PreviewRoute.all()).toEqual([])
    cloudflare.deleteTunnel.mockClear()
    await service.teardown({ threadId: 'thr-1' })
    expect(cloudflare.deleteTunnel).not.toHaveBeenCalled()
  })

  it('keeps other threads untouched on teardown', async () => {
    await service.expose({ threadId: 'thr-1', userId: 'usr-1', port: 3000 })
    const other = await service.expose({
      threadId: 'thr-2',
      userId: 'usr-2',
      port: 3000,
    })

    await service.teardown({ threadId: 'thr-1' })

    expect(other.tunnelToken).toBe('tok-2')
    const rows = await db.orm.public.PreviewTunnel.all()
    expect(rows.map((row) => row.threadId)).toEqual(['thr-2'])
  })

  it('removes the dns record when the ingress update fails', async () => {
    cloudflare.putIngress.mockRejectedValueOnce(new Error('cf down'))

    await expect(
      service.expose({ threadId: 'thr-1', userId: 'usr-1', port: 3000 }),
    ).rejects.toThrow('cf down')

    expect(cloudflare.deleteDnsRecord).toHaveBeenCalledTimes(1)
    expect(await db.orm.public.PreviewRoute.all()).toEqual([])
  })

  it('adopts an existing cname that already points at this tunnel', async () => {
    cloudflare.createCname.mockRejectedValueOnce(new CloudflareRecordExistsError('exists'))
    cloudflare.findDnsRecord.mockResolvedValueOnce({
      id: 'rec-old',
      content: 'tun-1.cfargotunnel.com',
    })

    await service.expose({ threadId: 'thr-1', userId: 'usr-1', port: 3000 })

    expect(cloudflare.repointCname).not.toHaveBeenCalled()
    expect((await db.orm.public.PreviewRoute.all())[0]?.dnsRecordId).toBe('rec-old')
  })

  it('repoints an existing cname that targets another tunnel', async () => {
    cloudflare.createCname.mockRejectedValueOnce(new CloudflareRecordExistsError('exists'))
    cloudflare.findDnsRecord.mockResolvedValueOnce({
      id: 'rec-old',
      content: 'tun-orphan.cfargotunnel.com',
    })

    const reply = await service.expose({
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })

    expect(cloudflare.repointCname).toHaveBeenCalledWith({
      recordId: 'rec-old',
      hostname: new URL(reply.url).hostname,
      tunnelId: 'tun-1',
    })
    expect((await db.orm.public.PreviewRoute.all())[0]?.dnsRecordId).toBe('rec-old')
  })
})
