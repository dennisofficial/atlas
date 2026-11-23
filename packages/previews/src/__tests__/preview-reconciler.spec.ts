import { type Db, type Tx } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import {
  type CloudflareTunnelClient,
  type DnsRecordSummary,
  type TunnelSummary,
} from '../cloudflare-tunnel.client'
import { EPreviewTunnelState } from '../preview-state'
import {
  type PreviewReconcileDeps,
  previewPodsNeedingWork,
  reconcilePreviewTunnel,
  runPreviewPass,
  sweepPreviewOrphans,
} from '../preview-reconciler'
import { type PreviewSecretCipher } from '../preview-tunnels'

const fakeCipher: PreviewSecretCipher = {
  encrypt: (plain) => `enc:${plain}`,
  decrypt: (blob) => blob.slice(4),
}
const NOW = new Date('2026-11-23T12:00:00.000Z')
const HOURS = 30 * 60_000

describe('preview reconciler', () => {
  const currentDb = useTestDatabase()
  let openTransactions = 0
  let livePeers = 0
  let dnsRecords = new Map<string, { id: string; content: string }>()
  const touched: string[] = []
  const guard = (name: string) => {
    touched.push(name)
    expect(openTransactions).toBe(0)
  }
  const cloudflare = {
    ensureTunnel: vi.fn(async (_args: { name: string }) => {
      guard('ensureTunnel')
      return { id: 'tun-1', token: 'tok-1' }
    }),
    putIngress: vi.fn(async (_args: { tunnelId: string; rules: unknown[] }) => guard('putIngress')),
    findDnsRecord: vi.fn(async (args: { hostname: string }) => {
      guard('findDnsRecord')
      return dnsRecords.get(args.hostname)
    }),
    createCname: vi.fn(async (args: { hostname: string; tunnelId: string }) => {
      guard('createCname')
      return { id: `rec-${args.hostname}` }
    }),
    repointCname: vi.fn(async (_args: { recordId: string; hostname: string; tunnelId: string }) =>
      guard('repointCname'),
    ),
    deleteDnsRecord: vi.fn(async (_args: { recordId: string }) => guard('deleteDnsRecord')),
    deleteTunnel: vi.fn(async (_args: { tunnelId: string }) => guard('deleteTunnel')),
    listTunnels: vi.fn(async (_args: { namePrefix: string }): Promise<TunnelSummary[]> => {
      guard('listTunnels')
      return []
    }),
    listDnsRecords: vi.fn(async (_args: { nameSuffix: string }): Promise<DnsRecordSummary[]> => {
      guard('listDnsRecords')
      return []
    }),
  }

  const trackingDb = (real: Db): Db =>
    ({
      orm: real.orm,
      raw: real.raw,
      query: real.query.bind(real),
      transaction: async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
        openTransactions += 1
        try {
          return await real.transaction(work)
        } finally {
          openTransactions -= 1
        }
      },
    }) as unknown as Db

  const deps = (): PreviewReconcileDeps => ({
    db: trackingDb(currentDb().db),
    cloudflare: cloudflare as unknown as CloudflareTunnelClient,
    domain: 'byatlas.dev',
    cipher: fakeCipher,
    livePeersOf: async () => livePeers,
    now: () => NOW,
  })

  const seedTunnel = async (args: {
    podSessionId: string
    state?: string
    tunnelId?: string
    sealed?: string
    label?: string
    syncedAt?: Date | null
  }) =>
    await currentDb().db.orm.public.PreviewTunnel.create({
      userId: 'usr-1',
      podSessionId: args.podSessionId,
      createdByThreadId: 'thr-1',
      label: args.label ?? 'label00001',
      state: args.state ?? EPreviewTunnelState.Ready,
      tunnelId: args.tunnelId ?? '',
      sealedTunnelToken: args.sealed ?? '',
      syncedAt: args.syncedAt ?? null,
    })

  const seedRoute = async (args: {
    previewTunnelId: string
    port: number
    hostname: string
    dnsRecordId?: string
  }) =>
    await currentDb().db.orm.public.PreviewRoute.create({
      previewTunnelId: args.previewTunnelId,
      port: args.port,
      hostname: args.hostname,
      dnsRecordId: args.dnsRecordId ?? null,
    })

  const routesOf = async () => await currentDb().db.orm.public.PreviewRoute.all()

  beforeEach(async () => {
    openTransactions = 0
    livePeers = 0
    dnsRecords = new Map()
    touched.length = 0
    for (const mock of Object.values(cloudflare)) mock.mockClear()
    cloudflare.listTunnels.mockResolvedValue([])
    cloudflare.listDnsRecords.mockResolvedValue([])
    await seedUser({ db: currentDb().db, id: 'usr-1' })
  })

  it('recreates a missing cname and repoints one aimed at another tunnel', async () => {
    const tunnel = await seedTunnel({
      podSessionId: 'pod-1',
      tunnelId: 'tun-1',
      sealed: 'enc:tok-1',
    })
    await seedRoute({
      previewTunnelId: tunnel.id,
      port: 3000,
      hostname: '3000-label00001.byatlas.dev',
    })
    await seedRoute({
      previewTunnelId: tunnel.id,
      port: 4000,
      hostname: '4000-label00001.byatlas.dev',
      dnsRecordId: 'rec-stale',
    })
    dnsRecords.set('4000-label00001.byatlas.dev', {
      id: 'rec-stale',
      content: 'tun-other.cfargotunnel.com',
    })

    const outcome = await reconcilePreviewTunnel(deps(), { podSessionId: 'pod-1' })

    expect(outcome).toEqual({ kind: 'synced' })
    expect(cloudflare.createCname).toHaveBeenCalledWith({
      hostname: '3000-label00001.byatlas.dev',
      tunnelId: 'tun-1',
    })
    expect(cloudflare.repointCname).toHaveBeenCalledWith({
      recordId: 'rec-stale',
      hostname: '4000-label00001.byatlas.dev',
      tunnelId: 'tun-1',
    })
    expect((await routesOf()).map((route) => route.dnsRecordId).sort()).toEqual([
      'rec-3000-label00001.byatlas.dev',
      'rec-stale',
    ])
    expect(cloudflare.putIngress).toHaveBeenCalledTimes(1)
    expect(cloudflare.putIngress.mock.calls[0]?.[0]).toEqual({
      tunnelId: 'tun-1',
      rules: [
        { hostname: '3000-label00001.byatlas.dev', port: 3000 },
        { hostname: '4000-label00001.byatlas.dev', port: 4000 },
      ],
    })
    const row = await currentDb()
      .db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' })
      .first()
    expect(row?.state).toBe(EPreviewTunnelState.Ready)
    expect(row?.syncedAt).toEqual(NOW)
    expect(row?.lastError).toBeNull()
  })

  it('recreates a tunnel deleted out of band and seals the new token', async () => {
    await seedTunnel({ podSessionId: 'pod-1', tunnelId: 'tun-gone', sealed: 'enc:old' })
    cloudflare.ensureTunnel.mockResolvedValueOnce({ id: 'tun-new', token: 'tok-new' })

    expect(await reconcilePreviewTunnel(deps(), { podSessionId: 'pod-1' })).toEqual({
      kind: 'synced',
    })

    expect(cloudflare.ensureTunnel).toHaveBeenCalledWith({ name: 'atlas-pod-1' })
    const row = await currentDb()
      .db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' })
      .first()
    expect(row?.tunnelId).toBe('tun-new')
    expect(row?.sealedTunnelToken).toBe('enc:tok-new')
  })

  it('keeps the same seal when the tunnel is still the row tunnel', async () => {
    await seedTunnel({ podSessionId: 'pod-1', tunnelId: 'tun-1', sealed: 'enc:tok-1' })

    await reconcilePreviewTunnel(deps(), { podSessionId: 'pod-1' })

    const row = await currentDb()
      .db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' })
      .first()
    expect(row?.sealedTunnelToken).toBe('enc:tok-1')
  })

  it('skips deletion while another session of the pod is live', async () => {
    await seedTunnel({
      podSessionId: 'pod-1',
      state: EPreviewTunnelState.Deleting,
      tunnelId: 'tun-1',
    })
    livePeers = 1

    expect(await reconcilePreviewTunnel(deps(), { podSessionId: 'pod-1' })).toEqual({
      kind: 'skipped',
    })
    expect(cloudflare.deleteTunnel).not.toHaveBeenCalled()
    expect(await currentDb().db.orm.public.PreviewTunnel.all()).toHaveLength(1)
  })

  it('deletes the dns records then the tunnel then the rows', async () => {
    const tunnel = await seedTunnel({
      podSessionId: 'pod-1',
      state: EPreviewTunnelState.Deleting,
      tunnelId: 'tun-1',
    })
    await seedRoute({
      previewTunnelId: tunnel.id,
      port: 3000,
      hostname: '3000-label00001.byatlas.dev',
      dnsRecordId: 'rec-1',
    })

    expect(await reconcilePreviewTunnel(deps(), { podSessionId: 'pod-1' })).toEqual({
      kind: 'deleted',
    })

    expect(touched).toEqual(['deleteDnsRecord', 'deleteTunnel'])
    expect(cloudflare.deleteDnsRecord).toHaveBeenCalledWith({ recordId: 'rec-1' })
    expect(cloudflare.deleteTunnel).toHaveBeenCalledWith({ tunnelId: 'tun-1' })
    expect(await currentDb().db.orm.public.PreviewTunnel.all()).toEqual([])
    expect(await routesOf()).toEqual([])
  })

  it('keeps the rows when the tunnel delete fails and deletes them next pass', async () => {
    await seedTunnel({
      podSessionId: 'pod-1',
      state: EPreviewTunnelState.Deleting,
      tunnelId: 'tun-1',
    })
    cloudflare.deleteTunnel.mockRejectedValueOnce(new Error('cf down'))

    expect(await reconcilePreviewTunnel(deps(), { podSessionId: 'pod-1' })).toEqual({
      kind: 'failed',
      reason: 'cf down',
    })
    const kept = await currentDb()
      .db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' })
      .first()
    expect(kept?.state).toBe(EPreviewTunnelState.Deleting)
    expect(kept?.lastError).toBe('cf down')

    expect(await reconcilePreviewTunnel(deps(), { podSessionId: 'pod-1' })).toEqual({
      kind: 'deleted',
    })
    expect(await currentDb().db.orm.public.PreviewTunnel.all()).toEqual([])
  })

  it('answers skipped for a pod without a row', async () => {
    expect(await reconcilePreviewTunnel(deps(), { podSessionId: 'pod-none' })).toEqual({
      kind: 'skipped',
    })
    expect(touched).toEqual([])
  })

  it('runs a pass over the pods that need work without a transaction open', async () => {
    await seedTunnel({ podSessionId: 'pod-1', state: EPreviewTunnelState.Pending })
    await seedTunnel({
      podSessionId: 'pod-2',
      state: EPreviewTunnelState.Deleting,
      tunnelId: 'tun-2',
    })
    const lines: string[] = []

    const summary = await runPreviewPass(deps(), { log: (line) => lines.push(line) })

    expect(summary).toMatchObject({ checked: 2, synced: 1, deleted: 1, failed: 0 })
    expect(lines.at(-1)).toContain('checked 2')
  })

  it('logs a failed pod and keeps going', async () => {
    await seedTunnel({ podSessionId: 'pod-1', state: EPreviewTunnelState.Pending })
    await seedTunnel({ podSessionId: 'pod-2', state: EPreviewTunnelState.Pending })
    cloudflare.ensureTunnel.mockRejectedValueOnce(new Error('cf down'))
    const lines: string[] = []

    const summary = await runPreviewPass(deps(), { log: (line) => lines.push(line) })

    expect(summary.failed).toBe(1)
    expect(summary.synced).toBe(1)
    expect(summary.failures[0]?.podSessionId).toBe('pod-1')
    expect(lines[0]).toContain('cf down')
  })

  it('lists the pods needing work oldest first and passes over a clean row', async () => {
    await seedTunnel({ podSessionId: 'pod-old', state: EPreviewTunnelState.Pending })
    await seedTunnel({ podSessionId: 'pod-unsynced', state: EPreviewTunnelState.Ready })
    const clean = await seedTunnel({ podSessionId: 'pod-clean', state: EPreviewTunnelState.Ready })
    await currentDb().db.orm.public.PreviewTunnel.where({ id: clean.id }).update({ syncedAt: NOW })

    const pods = await previewPodsNeedingWork(deps(), { limit: 10 })

    expect([...pods].sort()).toEqual(['pod-old', 'pod-unsynced'])
    expect(await previewPodsNeedingWork(deps(), { limit: 1 })).toHaveLength(1)
  })

  it('plans the orphan sweep and then deletes what has no row', async () => {
    const tunnel = await seedTunnel({ podSessionId: 'pod-1', tunnelId: 'tun-1' })
    await seedRoute({
      previewTunnelId: tunnel.id,
      port: 3000,
      hostname: '3000-label00001.byatlas.dev',
      dnsRecordId: 'rec-1',
    })
    cloudflare.listTunnels.mockResolvedValue([
      { id: 'tun-leak', name: 'atlas-leaked', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'tun-1', name: 'atlas-pod-1', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'tun-fresh', name: 'atlas-fresh', createdAt: '2026-11-23T11:59:00.000Z' },
    ])
    cloudflare.listDnsRecords.mockResolvedValue([
      {
        id: 'rec-1',
        name: '3000-label00001.byatlas.dev',
        content: 'tun-1.cfargotunnel.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'rec-2',
        name: '4000-orphan0001.byatlas.dev',
        content: 'tun-dead.cfargotunnel.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'rec-3',
        name: 'www.byatlas.dev',
        content: 'elsewhere',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    const planned = await sweepPreviewOrphans(deps(), { graceMs: HOURS, dryRun: true })

    expect(planned).toEqual({
      dryRun: true,
      tunnels: [{ id: 'tun-leak', name: 'atlas-leaked' }],
      dnsRecords: [{ id: 'rec-2', name: '4000-orphan0001.byatlas.dev' }],
    })
    expect(cloudflare.deleteTunnel).not.toHaveBeenCalled()
    expect(cloudflare.deleteDnsRecord).not.toHaveBeenCalled()

    const done = await sweepPreviewOrphans(deps(), { graceMs: HOURS, dryRun: false })

    expect(done.tunnels).toEqual(planned.tunnels)
    expect(done.dnsRecords).toEqual(planned.dnsRecords)
    expect(cloudflare.deleteTunnel).toHaveBeenCalledWith({ tunnelId: 'tun-leak' })
    expect(cloudflare.deleteDnsRecord).toHaveBeenCalledWith({ recordId: 'rec-2' })
  })
})
