import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { PreviewReconciler } from '../preview-reconciler'
import { EPreviewTunnelState } from '../preview-state'
import { PreviewTunnels } from '../preview-tunnels'
import { fakeCipher, tunnelFakes } from './preview-tunnel-fakes'

describe('the host expose and the preview reconcile pass', () => {
  const currentDb = useTestDatabase()
  const fakes = tunnelFakes()
  const cloudflare = fakes.cloudflare

  const depsOf = () => ({
    db: currentDb().db,
    cipher: fakeCipher,
    domain: 'byatlas.dev',
    cloudflare: fakes.client,
    livePeersOf: async () => 0,
  })

  const rowOf = async () =>
    await currentDb().db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' }).first()

  beforeEach(async () => {
    fakes.reset()
    await seedUser({ db: currentDb().db, id: 'usr-1' })
  })

  it('creates one tunnel when the reconcile pass syncs a pod the host is sealing', async () => {
    const parked = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let entrants = 0
    fakes.gates.beforeCreate = async () => {
      entrants += 1
      if (entrants === 1) parked.resolve()
      if (entrants === 2) second.resolve()
      await release.promise
    }

    const host = new PreviewTunnels(depsOf())
    const reconciler = new PreviewReconciler(depsOf())

    const exposed = host.expose({
      podSessionId: 'pod-1',
      threadId: 'thr-1',
      userId: 'usr-1',
      port: 3000,
    })
    await parked.promise
    const synced = reconciler.run({ podSessionId: 'pod-1' })

    await Promise.race([second.promise, synced])
    release.resolve()

    const [reply, outcome] = await Promise.all([exposed, synced])

    expect(fakes.counts.created).toBe(1)
    expect(cloudflare.ensureTunnel).toHaveBeenCalledTimes(1)
    expect(reply.tunnelToken).toBe('tok-1')
    expect(outcome).toEqual({ kind: 'skipped' })
    const row = await rowOf()
    expect(row?.state).toBe(EPreviewTunnelState.Ready)
    expect(row?.tunnelId).toBe('tun-1')
    expect(row?.sealedTunnelToken).toBe('enc:tok-1')

    expect(await reconciler.run({ podSessionId: 'pod-1' })).toEqual({ kind: 'synced' })

    expect(fakes.counts.created).toBe(1)
    expect(cloudflare.putIngress).toHaveBeenCalledWith({
      tunnelId: 'tun-1',
      rules: [{ hostname: reply.url.replace('https://', ''), port: 3000 }],
    })
    expect((await rowOf())?.syncedAt).not.toBeNull()
  })

  it('converges on the tunnel a seal that died left behind', async () => {
    await currentDb().db.orm.public.PreviewTunnel.create({
      userId: 'usr-1',
      podSessionId: 'pod-1',
      createdByThreadId: 'thr-1',
      label: 'label00001',
      state: EPreviewTunnelState.Pending,
    })
    fakes.seed({ name: 'atlas-pod-1', tunnel: { id: 'tun-left', token: 'tok-left' } })
    const reconciler = new PreviewReconciler(depsOf())

    expect(await reconciler.run({ podSessionId: 'pod-1' })).toEqual({ kind: 'synced' })

    expect(fakes.counts.created).toBe(0)
    const row = await rowOf()
    expect(row?.state).toBe(EPreviewTunnelState.Ready)
    expect(row?.tunnelId).toBe('tun-left')
    expect(row?.sealedTunnelToken).toBe('enc:tok-left')
  })
})
