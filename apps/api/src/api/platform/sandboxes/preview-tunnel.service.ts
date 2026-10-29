import { randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { db, type Row, type Tx } from '@dltech/atlas-db'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { CloudflareRecordExistsError, CloudflareTunnelClient } from './cloudflare-tunnel.client'

const LABEL_LENGTH = 10
const TUNNEL_SUFFIX_LENGTH = 6

function newLabel(): string {
  let label = ''
  while (label.length < LABEL_LENGTH) label += randomBytes(8).readBigUInt64BE().toString(36)
  return label.slice(0, LABEL_LENGTH)
}

function newTunnelSuffix(): string {
  return randomBytes(8)
    .readBigUInt64BE()
    .toString(36)
    .padStart(TUNNEL_SUFFIX_LENGTH, '0')
    .slice(-TUNNEL_SUFFIX_LENGTH)
}

async function lockPreviews(args: { tx: Tx; threadId: string }): Promise<void> {
  const statement = args.tx.raw
    .sql`SELECT pg_advisory_xact_lock(hashtext(${`preview:${args.threadId}`}))`
    .affectedCount()
    .build()
  await args.tx.query(statement)
}

@Injectable()
export class PreviewTunnelService {
  constructor(
    private readonly env: EnvService,
    private readonly cipher: SecretCipherService,
    private readonly cloudflare: CloudflareTunnelClient,
  ) {}

  async expose(args: {
    threadId: string
    userId: string
    port: number
  }): Promise<{ url: string; tunnelToken: string }> {
    const tunnel = await this.ensureTunnel(args)
    const hostname = await this.ensureRoute({ tunnel, port: args.port })
    return {
      url: `https://${hostname}`,
      tunnelToken: this.cipher.decrypt(tunnel.sealedTunnelToken),
    }
  }

  async teardown(args: { threadId: string }): Promise<void> {
    await db.transaction(async (tx) => {
      await lockPreviews({ tx, threadId: args.threadId })
      const tunnel = await tx.orm.public.PreviewTunnel.where({
        threadId: args.threadId,
      }).first()
      if (tunnel === null) return
      const routes = await tx.orm.public.PreviewRoute.where({
        previewTunnelId: tunnel.id,
      }).all()
      for (const route of routes) {
        await this.cloudflare.deleteDnsRecord({ recordId: route.dnsRecordId })
      }
      await this.cloudflare.deleteTunnel({ tunnelId: tunnel.tunnelId })
      await tx.orm.public.PreviewTunnel.where({
        id: tunnel.id,
      }).deleteAndCount()
    })
  }

  private ensureTunnel(args: { threadId: string; userId: string }): Promise<Row<'PreviewTunnel'>> {
    return db.transaction(async (tx) => {
      await lockPreviews({ tx, threadId: args.threadId })
      const existing = await tx.orm.public.PreviewTunnel.where({
        threadId: args.threadId,
      }).first()
      if (existing !== null) return existing
      const created = await this.cloudflare.createTunnel({
        name: `atlas-${args.threadId}-${newTunnelSuffix()}`,
      })
      try {
        return await tx.orm.public.PreviewTunnel.create({
          userId: args.userId,
          threadId: args.threadId,
          tunnelId: created.id,
          sealedTunnelToken: this.cipher.encrypt(created.token),
          label: newLabel(),
        })
      } catch (failure) {
        await this.cloudflare.deleteTunnel({ tunnelId: created.id })
        throw failure
      }
    })
  }

  private ensureRoute(args: { tunnel: Row<'PreviewTunnel'>; port: number }): Promise<string> {
    const { tunnel, port } = args
    return db.transaction(async (tx) => {
      await lockPreviews({ tx, threadId: tunnel.threadId })
      const existing = await tx.orm.public.PreviewRoute.where({
        previewTunnelId: tunnel.id,
        port,
      }).first()
      if (existing !== null) return existing.hostname
      const hostname = `${port}-${tunnel.label}.${this.env.get('PREVIEW_DOMAIN')}`
      const record = await this.claimCname({
        hostname,
        tunnelId: tunnel.tunnelId,
      })
      try {
        await tx.orm.public.PreviewRoute.create({
          previewTunnelId: tunnel.id,
          port,
          hostname,
          dnsRecordId: record.id,
        })
        const routes = await tx.orm.public.PreviewRoute.where({
          previewTunnelId: tunnel.id,
        }).all()
        await this.cloudflare.putIngress({
          tunnelId: tunnel.tunnelId,
          rules: routes.map((route) => ({
            hostname: route.hostname,
            port: route.port,
          })),
        })
      } catch (failure) {
        await this.cloudflare.deleteDnsRecord({ recordId: record.id })
        throw failure
      }
      return hostname
    })
  }

  private async claimCname(args: { hostname: string; tunnelId: string }): Promise<{ id: string }> {
    try {
      return await this.cloudflare.createCname(args)
    } catch (failure) {
      if (!(failure instanceof CloudflareRecordExistsError)) throw failure
      const existing = await this.cloudflare.findDnsRecord({
        hostname: args.hostname,
      })
      if (existing === undefined) throw failure
      if (existing.content !== `${args.tunnelId}.cfargotunnel.com`) {
        await this.cloudflare.repointCname({
          recordId: existing.id,
          hostname: args.hostname,
          tunnelId: args.tunnelId,
        })
      }
      return { id: existing.id }
    }
  }
}
