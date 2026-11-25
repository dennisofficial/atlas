import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { PreviewTunnels } from '../preview-tunnels'
import { fakeCipher, transactionSignals, tunnelFakes } from './preview-tunnel-fakes'

describe('PreviewTunnels under concurrency', () => {
  const currentDb = useTestDatabase()
  const fakes = tunnelFakes()
  const cloudflare = fakes.cloudflare
  const previews = new PreviewTunnels({
    db: currentDb().db,
    cipher: fakeCipher,
    domain: 'byatlas.dev',
    cloudflare: fakes.client,
  })

  beforeEach(async () => {
    fakes.reset()
    await seedUser({ db: currentDb().db, id: 'usr-1' })
  })

  it('creates one cloudflare tunnel for two concurrent exposes of a new pod', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    fakes.gates.beforeCreate = async () => {
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
    expect(fakes.counts.created).toBe(1)
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
    fakes.gates.beforeCreate = async () => {
      entered.resolve()
      await creating.promise
    }
    const signals = transactionSignals(currentDb().db)
    const watched = new PreviewTunnels({
      db: signals.db,
      cipher: fakeCipher,
      domain: 'byatlas.dev',
      cloudflare: fakes.client,
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
})
