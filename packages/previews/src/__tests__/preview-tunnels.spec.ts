import { type Db, type Tx } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { type CloudflareTunnelClient } from '../cloudflare-tunnel.client'
import { EPreviewTunnelState } from '../preview-state'
import { PreviewTunnels, type PreviewSecretCipher } from '../preview-tunnels'

const fakeCipher: PreviewSecretCipher = {
  encrypt: (plain) => `enc:${plain}`,
  decrypt: (blob) => blob.slice(4),
}

const transactionSignals = (real: Db) => {
  const waiters: Array<() => void> = []
  const db = {
    orm: real.orm,
    raw: real.raw,
    query: real.query.bind(real),
    transaction: async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
      const result = await real.transaction(work)
      waiters.shift()?.()
      return result
    },
  } as unknown as Db
  const next = () => {
    const signal = Promise.withResolvers<void>()
    waiters.push(() => signal.resolve())
    return signal.promise
  }
  return { db, next }
}

describe('PreviewTunnels', () => {
  const currentDb = useTestDatabase()
  const tunnels = new Map<string, { id: string; token: string }>()
  let created = 0
  let beforeCreate: (() => Promise<void>) | undefined
  const cloudflare = {
    ensureTunnel: vi.fn(async (args: { name: string }) => {
      const held = tunnels.get(args.name)
      if (held !== undefined) return held
      await beforeCreate?.()
      created += 1
      const tunnel = { id: `tun-${created}`, token: `tok-${created}` }
      tunnels.set(args.name, tunnel)
      return tunnel
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
  const previews = new PreviewTunnels({
    db: currentDb().db,
    cipher: fakeCipher,
    domain: 'byatlas.dev',
    cloudflare: cloudflare as unknown as CloudflareTunnelClient,
  })

  beforeEach(async () => {
    created = 0
    beforeCreate = undefined
    tunnels.clear()
    for (const mock of Object.values(cloudflare)) mock.mockClear()
    await seedUser({ db: currentDb().db, id: 'usr-1' })
    await seedUser({ db: currentDb().db, id: 'usr-2' })
  })

  it('creates the pod tunnel and a ready row, with no cloudflare call after the create', async () => {
    const reply = await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })

    expect(reply.tunnelToken).toBe('tok-1')
    expect(reply.url).toMatch(/^https:\/\/3000-[0-9a-z]{10}\.byatlas\.dev$/)
    expect(cloudflare.ensureTunnel).toHaveBeenCalledWith({ name: 'atlas-pod-1' })
    expect(cloudflare.createCname).not.toHaveBeenCalled()
    expect(cloudflare.putIngress).not.toHaveBeenCalled()
    const row = await currentDb()
      .db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' })
      .first()
    expect(row?.state).toBe(EPreviewTunnelState.Ready)
    expect(row?.tunnelId).toBe('tun-1')
    expect(row?.sealedTunnelToken).toBe('enc:tok-1')
    expect(row?.createdByThreadId).toBe('thr-1')
    expect(row?.syncedAt).toBeNull()
  })

  it('leaves a pending row carrying the error when the tunnel cannot be created', async () => {
    cloudflare.ensureTunnel.mockRejectedValueOnce(new Error('cf down'))

    await expect(
      previews.expose({
        podSessionId: 'pod-1',
        threadId: 'thr-1',
        userId: 'usr-1',
        port: 3000,
      }),
    ).rejects.toThrow('cf down')

    const row = await currentDb()
      .db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' })
      .first()
    expect(row?.state).toBe(EPreviewTunnelState.Pending)
    expect(row?.lastError).toBe('cf down')
    expect(row?.tunnelId).toBe('')
    expect(await currentDb().db.orm.public.PreviewRoute.all()).toEqual([])
  })

  it('answers a repeated port without calling cloudflare', async () => {
    const first = await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    for (const mock of Object.values(cloudflare)) mock.mockClear()

    const second = await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-2',
      userId: 'usr-1',
      port: 3000,
    })

    expect(second).toEqual(first)
    for (const mock of Object.values(cloudflare)) expect(mock).not.toHaveBeenCalled()
  })

  it('shares one tunnel and one label across two ports of a pod', async () => {
    const first = await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    const second = await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-2',
      userId: 'usr-1',
      port: 4000,
    })

    expect(cloudflare.ensureTunnel).toHaveBeenCalledTimes(1)
    expect(first.url.split('-')[1]).toBe(second.url.split('-')[1])
    expect(await currentDb().db.orm.public.PreviewRoute.all()).toHaveLength(2)
  })

  it('creates one cloudflare tunnel for two concurrent exposes of a new pod', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    beforeCreate = async () => {
      entered.resolve()
      await release.promise
    }

    const first = previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    await entered.promise
    const second = previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-2',
      userId: 'usr-1',
      port: 3000,
    })
    const third = previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-2',
      userId: 'usr-1',
      port: 4000,
    })
    release.resolve()

    await Promise.all([first, second, third])

    expect(cloudflare.ensureTunnel).toHaveBeenCalledTimes(1)
    expect(created).toBe(1)
    expect(await currentDb().db.orm.public.PreviewRoute.all()).toHaveLength(2)
  })

  it('creates no second tunnel while the first expose is still recording the row', async () => {
    cloudflare.ensureTunnel.mockRejectedValueOnce(new Error('cf down'))
    await expect(
      previews.expose({
        podSessionId: 'pod-1',
        threadId: 'thr-1',
        userId: 'usr-1',
        port: 3000,
      }),
    ).rejects.toThrow('cf down')
    cloudflare.ensureTunnel.mockClear()

    const entered = Promise.withResolvers<void>()
    const creating = Promise.withResolvers<void>()
    beforeCreate = async () => {
      entered.resolve()
      await creating.promise
    }
    const signals = transactionSignals(currentDb().db)
    const watched = new PreviewTunnels({
      db: signals.db,
      cipher: fakeCipher,
      domain: 'byatlas.dev',
      cloudflare: cloudflare as unknown as CloudflareTunnelClient,
    })
    const holder = await currentDb().pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query(
        'SELECT 1 FROM "public"."PreviewTunnel" WHERE "podSessionId" = $1 FOR UPDATE',
        ['pod-1'],
      )

      const first = watched.expose({
        podSessionId: 'pod-1',
        threadId: 'thr-1',
        userId: 'usr-1',
        port: 3000,
      })
      await entered.promise
      creating.resolve()

      const secondRead = signals.next()
      const second = watched.expose({
        podSessionId: 'pod-1',
        threadId: 'thr-2',
        userId: 'usr-1',
        port: 4000,
      })
      await secondRead
      await currentDb().db.orm.public.PreviewRoute.all()
      await holder.query('ROLLBACK')

      const replies = await Promise.all([first, second])

      expect(cloudflare.ensureTunnel).toHaveBeenCalledTimes(1)
      expect(replies.map((reply) => reply.tunnelToken)).toEqual(['tok-1', 'tok-1'])
    } finally {
      holder.release()
    }
  })

  it('flips a deleting row back to pending when the tunnel cannot be re-sealed', async () => {
    await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    await previews.markDeleting({ podSessionId: 'pod-1' })
    cloudflare.ensureTunnel.mockRejectedValueOnce(new Error('cf down'))

    await expect(
      previews.expose({
        podSessionId: 'pod-1',
        threadId: 'thr-1',
        userId: 'usr-1',
        port: 3000,
      }),
    ).rejects.toThrow('cf down')

    const row = await currentDb()
      .db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' })
      .first()
    expect(row?.state).toBe(EPreviewTunnelState.Pending)
    expect(row?.lastError).toBe('cf down')
  })

  it('marks a tunnel deleting and clears the mark again', async () => {
    await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })

    await previews.markDeleting({ podSessionId: 'pod-1' })
    expect(
      (await currentDb().db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' }).first())
        ?.state,
    ).toBe(EPreviewTunnelState.Deleting)

    await previews.clearDeleting({ podSessionId: 'pod-1' })
    expect(
      (await currentDb().db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' }).first())
        ?.state,
    ).toBe(EPreviewTunnelState.Ready)
  })

  it('keeps a deleting mark with nothing to mark', async () => {
    await previews.markDeleting({ podSessionId: 'pod-absent' })
    await previews.clearDeleting({ podSessionId: 'pod-absent' })

    expect(await currentDb().db.orm.public.PreviewTunnel.all()).toEqual([])
  })

  it('retries the teardown when the tunnel delete throws', async () => {
    await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    cloudflare.deleteTunnel.mockRejectedValueOnce(new Error('cf down'))

    const first = await previews.teardown({ podSessionId: 'pod-1' })

    expect(first).toEqual({ kind: 'failed', reason: 'cf down' })
    const kept = await currentDb()
      .db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' })
      .first()
    expect(kept?.state).toBe(EPreviewTunnelState.Deleting)
    expect(kept?.lastError).toBe('cf down')

    const second = await previews.teardown({ podSessionId: 'pod-1' })

    expect(second).toEqual({ kind: 'deleted' })
    expect(cloudflare.deleteTunnel).toHaveBeenLastCalledWith({ tunnelId: 'tun-1' })
    expect(await currentDb().db.orm.public.PreviewTunnel.all()).toEqual([])
    expect(await currentDb().db.orm.public.PreviewRoute.all()).toEqual([])
  })

  it('keeps other pods untouched on teardown', async () => {
    await previews.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    const other = await previews.expose({
      podSessionId: 'pod-2',
      threadId: 'thr-2',
      userId: 'usr-2',
      port: 3000,
    })

    await previews.teardown({ podSessionId: 'pod-1' })

    expect(other.tunnelToken).toBe('tok-2')
    const rows = await currentDb().db.orm.public.PreviewTunnel.all()
    expect(rows.map((row) => row.podSessionId)).toEqual(['pod-2'])
  })
})
