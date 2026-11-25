import { type Db, type Row } from '@dltech/atlas-db'
import { type CloudflareTunnelClient } from './cloudflare-tunnel.client'
import { PreviewTunnelClaimedError } from './errors'
import { EPreviewTunnelState } from './preview-state'
import { type PreviewSecretCipher, lockPreviews, newPreviewLabel } from './preview-rows'
import {
  type PreviewReconcileDeps,
  type PreviewReconcileOutcome,
  reconcilePreviewTunnel,
} from './preview-reconciler'
import { EPreviewSeal, sealPreviewTunnel } from './preview-seal'

export type { PreviewSecretCipher } from './preview-rows'
export { lockPreviews, newPreviewLabel, tunnelNameOf } from './preview-rows'

export class PreviewTunnels {
  private readonly db: Db
  private readonly cipher: PreviewSecretCipher
  private readonly domain: string
  private readonly cloudflare: CloudflareTunnelClient
  private readonly livePeersOf: (podSessionId: string) => Promise<number>
  private readonly seals = new Map<string, Promise<string>>()

  constructor(args: {
    db: Db
    cipher: PreviewSecretCipher
    domain: string
    cloudflare: CloudflareTunnelClient
    livePeersOf?: (podSessionId: string) => Promise<number>
  }) {
    this.db = args.db
    this.cipher = args.cipher
    this.domain = args.domain
    this.cloudflare = args.cloudflare
    this.livePeersOf = args.livePeersOf ?? (async () => 0)
  }

  async expose(args: {
    podSessionId: string
    threadId: string
    userId: string
    port: number
  }): Promise<{ url: string; tunnelToken: string }> {
    const row = await this.ensureTunnelRow(args)
    const tunnelToken = await this.sealTunnel({ podSessionId: args.podSessionId, row })
    const hostname = await this.reserveRoute({
      podSessionId: args.podSessionId,
      previewTunnelId: row.id,
      port: args.port,
    })
    return { url: `https://${hostname}`, tunnelToken }
  }

  async markDeleting(args: { podSessionId: string }): Promise<void> {
    await this.db.orm.public.PreviewTunnel.where({
      podSessionId: args.podSessionId,
    }).updateAndCount({ state: EPreviewTunnelState.Deleting })
  }

  async clearDeleting(args: { podSessionId: string }): Promise<void> {
    await this.db.orm.public.PreviewTunnel.where({
      podSessionId: args.podSessionId,
      state: EPreviewTunnelState.Deleting,
    }).updateAndCount({ state: EPreviewTunnelState.Ready })
  }

  async teardown(args: { podSessionId: string }): Promise<PreviewReconcileOutcome> {
    await this.markDeleting({ podSessionId: args.podSessionId })
    return await reconcilePreviewTunnel(this.reconcileDeps(), {
      podSessionId: args.podSessionId,
    })
  }

  private reconcileDeps(): PreviewReconcileDeps {
    return {
      db: this.db,
      cloudflare: this.cloudflare,
      cipher: this.cipher,
      domain: this.domain,
      livePeersOf: this.livePeersOf,
    }
  }

  private ensureTunnelRow(args: {
    podSessionId: string
    threadId: string
    userId: string
  }): Promise<Row<'PreviewTunnel'>> {
    return this.db.transaction(async (tx) => {
      await lockPreviews({ tx, podSessionId: args.podSessionId })
      const existing = await tx.orm.public.PreviewTunnel.where({
        podSessionId: args.podSessionId,
      }).first()
      if (existing === null) {
        return await tx.orm.public.PreviewTunnel.create({
          userId: args.userId,
          podSessionId: args.podSessionId,
          createdByThreadId: args.threadId,
          label: newPreviewLabel(),
          state: EPreviewTunnelState.Pending,
        })
      }
      if (existing.state !== EPreviewTunnelState.Deleting) return existing
      await tx.orm.public.PreviewTunnel.where({ id: existing.id }).updateAndCount({
        state: EPreviewTunnelState.Pending,
      })
      return { ...existing, state: EPreviewTunnelState.Pending }
    })
  }

  private sealTunnel(args: { podSessionId: string; row: Row<'PreviewTunnel'> }): Promise<string> {
    const running = this.seals.get(args.row.id)
    if (running !== undefined) return running
    const call = this.sealOnce(args)
    this.seals.set(args.row.id, call)
    void call.then(
      () => this.seals.delete(args.row.id),
      () => this.seals.delete(args.row.id),
    )
    return call
  }

  private async sealOnce(args: {
    podSessionId: string
    row: Row<'PreviewTunnel'>
  }): Promise<string> {
    const outcome = await sealPreviewTunnel({
      deps: this.reconcileDeps(),
      podSessionId: args.podSessionId,
      previewTunnelId: args.row.id,
      seal: EPreviewSeal.Reuse,
    })
    if (outcome.kind === 'claimed-elsewhere') {
      throw new PreviewTunnelClaimedError(
        `another process is creating the tunnel of ${args.podSessionId}`,
      )
    }
    return outcome.tunnelToken
  }

  private reserveRoute(args: {
    podSessionId: string
    previewTunnelId: string
    port: number
  }): Promise<string> {
    return this.db.transaction(async (tx) => {
      await lockPreviews({ tx, podSessionId: args.podSessionId })
      const existing = await tx.orm.public.PreviewRoute.where({
        previewTunnelId: args.previewTunnelId,
        port: args.port,
      }).first()
      if (existing !== null) return existing.hostname
      const tunnel = await tx.orm.public.PreviewTunnel.where({
        id: args.previewTunnelId,
      }).first()
      if (tunnel === null) throw new Error(`preview tunnel ${args.previewTunnelId} disappeared`)
      const hostname = `${args.port}-${tunnel.label}.${this.domain}`
      await tx.orm.public.PreviewRoute.create({
        previewTunnelId: tunnel.id,
        port: args.port,
        hostname,
      })
      await tx.orm.public.PreviewTunnel.where({ id: tunnel.id }).updateAndCount({ syncedAt: null })
      return hostname
    })
  }
}
