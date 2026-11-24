import { type Db, type Row } from '@dltech/atlas-db'
import { type CloudflareTunnelClient } from './cloudflare-tunnel.client'
import { EPreviewTunnelState } from './preview-state'
import {
  type PreviewSecretCipher,
  dnsTargetOf,
  lockPreviews,
  messageOf,
  tunnelNameOf,
} from './preview-rows'

const DEFAULT_PASS_LIMIT = 200
const PREVIEW_TUNNEL_PREFIX = 'atlas-'
const PREVIEW_LABEL_PATTERN = /^\d+-[0-9a-z]{10}$/

export type PreviewReconcileDeps = {
  db: Db
  cloudflare: CloudflareTunnelClient
  domain: string
  cipher: PreviewSecretCipher
  livePeersOf: (podSessionId: string) => Promise<number>
  now?: () => Date
}

export type PreviewReconcileOutcome =
  | { kind: 'skipped' }
  | { kind: 'synced' }
  | { kind: 'deleted' }
  | { kind: 'failed'; reason: string }

export type PreviewPassSummary = {
  checked: number
  synced: number
  deleted: number
  skipped: number
  failed: number
  failures: Array<{ podSessionId: string; reason: string }>
}

export type PreviewOrphanSummary = {
  dryRun: boolean
  tunnels: Array<{ id: string; name: string }>
  dnsRecords: Array<{ id: string; name: string }>
}

function nowOf(deps: PreviewReconcileDeps): Date {
  return deps.now?.() ?? new Date()
}

function oldEnough(args: { at: string | undefined; now: Date; graceMs: number }): boolean {
  if (args.at === undefined) return true
  const createdAt = Date.parse(args.at)
  return Number.isNaN(createdAt) || args.now.getTime() - createdAt >= args.graceMs
}

export async function previewPodsNeedingWork(
  deps: { db: Db },
  args: { limit: number },
): Promise<string[]> {
  const rows = await deps.db.query(
    deps.db.raw.sql`SELECT "podSessionId" FROM "public"."PreviewTunnel"
      WHERE "state" IN (${EPreviewTunnelState.Pending}, ${EPreviewTunnelState.Deleting})
         OR "syncedAt" IS NULL
      ORDER BY "updatedAt" ASC
      LIMIT ${Math.max(1, Math.trunc(args.limit))}`
      .returnsRow({ podSessionId: 'pg/text@1' })
      .build(),
  )
  return rows.map((row) => row.podSessionId)
}

export async function reconcilePreviewTunnel(
  deps: PreviewReconcileDeps,
  args: { podSessionId: string },
): Promise<PreviewReconcileOutcome> {
  const row = await deps.db.orm.public.PreviewTunnel.where({
    podSessionId: args.podSessionId,
  }).first()
  if (row === null) return { kind: 'skipped' }
  if (row.state === EPreviewTunnelState.Deleting) return await deletePreview(deps, row)
  return await syncPreview(deps, row)
}

async function deletePreview(
  deps: PreviewReconcileDeps,
  row: Row<'PreviewTunnel'>,
): Promise<PreviewReconcileOutcome> {
  if ((await deps.livePeersOf(row.podSessionId)) > 0) return { kind: 'skipped' }
  const held = await deps.db.transaction(async (tx) => {
    await lockPreviews({ tx, podSessionId: row.podSessionId })
    const current = await tx.orm.public.PreviewTunnel.where({ id: row.id }).first()
    if (current === null || current.state !== EPreviewTunnelState.Deleting) return undefined
    const routes = await tx.orm.public.PreviewRoute.where({
      previewTunnelId: current.id,
    }).all()
    return { tunnelId: current.tunnelId, routes }
  })
  if (held === undefined) return { kind: 'skipped' }
  try {
    for (const route of held.routes) {
      if (route.dnsRecordId === null) continue
      await deps.cloudflare.deleteDnsRecord({ recordId: route.dnsRecordId })
    }
    if (held.tunnelId !== '') await deps.cloudflare.deleteTunnel({ tunnelId: held.tunnelId })
  } catch (failure) {
    const reason = messageOf(failure)
    await deps.db.orm.public.PreviewTunnel.where({ id: row.id }).updateAndCount({
      lastError: reason,
    })
    return { kind: 'failed', reason }
  }
  return await dropPreviewRows(deps, row.id)
}

async function dropPreviewRows(
  deps: PreviewReconcileDeps,
  previewTunnelId: string,
): Promise<PreviewReconcileOutcome> {
  const dropped = await deps.db.transaction(async (tx) => {
    const current = await tx.orm.public.PreviewTunnel.where({ id: previewTunnelId }).first()
    if (current === null) return true
    if (current.state !== EPreviewTunnelState.Deleting) return false
    await tx.orm.public.PreviewRoute.where({ previewTunnelId }).deleteAndCount()
    await tx.orm.public.PreviewTunnel.where({ id: previewTunnelId }).deleteAndCount()
    return true
  })
  return dropped ? { kind: 'deleted' } : { kind: 'skipped' }
}

async function syncPreview(
  deps: PreviewReconcileDeps,
  row: Row<'PreviewTunnel'>,
): Promise<PreviewReconcileOutcome> {
  try {
    const tunnel = await deps.cloudflare.ensureTunnel({ name: tunnelNameOf(row.podSessionId) })
    const keepsSeal = row.tunnelId === tunnel.id && row.sealedTunnelToken !== ''
    const sealedTunnelToken = keepsSeal ? row.sealedTunnelToken : deps.cipher.encrypt(tunnel.token)
    const rules = await syncRoutes(deps, { previewTunnelId: row.id, tunnelId: tunnel.id })
    await deps.cloudflare.putIngress({ tunnelId: tunnel.id, rules })
    await deps.db.orm.public.PreviewTunnel.where({ id: row.id }).updateAndCount({
      tunnelId: tunnel.id,
      sealedTunnelToken,
      state: EPreviewTunnelState.Ready,
      syncedAt: nowOf(deps),
      lastError: null,
    })
    return { kind: 'synced' }
  } catch (failure) {
    const reason = messageOf(failure)
    await deps.db.orm.public.PreviewTunnel.where({ id: row.id }).updateAndCount({
      lastError: reason,
    })
    return { kind: 'failed', reason }
  }
}

async function syncRoutes(
  deps: PreviewReconcileDeps,
  args: { previewTunnelId: string; tunnelId: string },
): Promise<Array<{ hostname: string; port: number }>> {
  const routes = await deps.db.orm.public.PreviewRoute.where({
    previewTunnelId: args.previewTunnelId,
  }).all()
  for (const route of routes) {
    const dnsRecordId = await syncDnsRecord(deps, {
      hostname: route.hostname,
      tunnelId: args.tunnelId,
    })
    if (dnsRecordId === route.dnsRecordId) continue
    await deps.db.orm.public.PreviewRoute.where({ id: route.id }).updateAndCount({ dnsRecordId })
  }
  return routes.map((route) => ({ hostname: route.hostname, port: route.port }))
}

async function syncDnsRecord(
  deps: PreviewReconcileDeps,
  args: { hostname: string; tunnelId: string },
): Promise<string> {
  const target = dnsTargetOf(args.tunnelId)
  const existing = await deps.cloudflare.findDnsRecord({ hostname: args.hostname })
  if (existing === undefined) {
    const created = await deps.cloudflare.createCname({
      hostname: args.hostname,
      tunnelId: args.tunnelId,
    })
    return created.id
  }
  if (existing.content === target) return existing.id
  await deps.cloudflare.repointCname({
    recordId: existing.id,
    hostname: args.hostname,
    tunnelId: args.tunnelId,
  })
  return existing.id
}

export async function runPreviewPass(
  deps: PreviewReconcileDeps,
  args: { log(line: string): void; limit?: number; podSessionIds?: readonly string[] },
): Promise<PreviewPassSummary> {
  const podSessionIds =
    args.podSessionIds ??
    (await previewPodsNeedingWork(deps, { limit: args.limit ?? DEFAULT_PASS_LIMIT }))
  const summary: PreviewPassSummary = {
    checked: 0,
    synced: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  }
  for (const podSessionId of podSessionIds) {
    const outcome = await reconcilePreviewTunnel(deps, { podSessionId })
    summary.checked += 1
    if (outcome.kind === 'failed') {
      summary.failed += 1
      summary.failures.push({ podSessionId, reason: outcome.reason })
      args.log(`failed ${podSessionId}: ${outcome.reason}`)
      continue
    }
    if (outcome.kind === 'synced') summary.synced += 1
    if (outcome.kind === 'deleted') summary.deleted += 1
    if (outcome.kind === 'skipped') summary.skipped += 1
    args.log(`${outcome.kind} ${podSessionId}`)
  }
  args.log(
    `preview pass: checked ${summary.checked}, synced ${summary.synced}, deleted ${summary.deleted}, skipped ${summary.skipped}, failed ${summary.failed}`,
  )
  return summary
}

export async function sweepPreviewOrphans(
  deps: PreviewReconcileDeps,
  args: { graceMs: number; dryRun: boolean },
): Promise<PreviewOrphanSummary> {
  const now = nowOf(deps)
  const rows = await deps.db.orm.public.PreviewTunnel.all()
  const tunnelNames = new Set(rows.map((row) => tunnelNameOf(row.podSessionId)))
  const routes = await deps.db.orm.public.PreviewRoute.all()
  const previewHostnames = new Set(routes.map((route) => route.hostname))
  const summary: PreviewOrphanSummary = { dryRun: args.dryRun, tunnels: [], dnsRecords: [] }
  for (const tunnel of await deps.cloudflare.listTunnels({ namePrefix: PREVIEW_TUNNEL_PREFIX })) {
    if (tunnelNames.has(tunnel.name)) continue
    if (!oldEnough({ at: tunnel.createdAt, now, graceMs: args.graceMs })) continue
    summary.tunnels.push({ id: tunnel.id, name: tunnel.name })
    if (!args.dryRun) await deps.cloudflare.deleteTunnel({ tunnelId: tunnel.id })
  }
  const records = await deps.cloudflare.listDnsRecords({ nameSuffix: `.${deps.domain}` })
  for (const record of records) {
    if (!isPreviewHostname({ hostname: record.name, domain: deps.domain })) continue
    if (previewHostnames.has(record.name)) continue
    if (!oldEnough({ at: record.createdAt, now, graceMs: args.graceMs })) continue
    summary.dnsRecords.push({ id: record.id, name: record.name })
    if (!args.dryRun) await deps.cloudflare.deleteDnsRecord({ recordId: record.id })
  }
  return summary
}

function isPreviewHostname(args: { hostname: string; domain: string }): boolean {
  const suffix = `.${args.domain}`
  if (!args.hostname.endsWith(suffix)) return false
  return PREVIEW_LABEL_PATTERN.test(args.hostname.slice(0, -suffix.length))
}

export class PreviewReconciler {
  private readonly deps: PreviewReconcileDeps

  constructor(deps: PreviewReconcileDeps) {
    this.deps = deps
  }

  run(args: { podSessionId: string }): Promise<PreviewReconcileOutcome> {
    return reconcilePreviewTunnel(this.deps, args)
  }

  pass(args: {
    log(line: string): void
    limit?: number
    podSessionIds?: readonly string[]
  }): Promise<PreviewPassSummary> {
    return runPreviewPass(this.deps, args)
  }

  sweep(args: { graceMs: number; dryRun: boolean }): Promise<PreviewOrphanSummary> {
    return sweepPreviewOrphans(this.deps, args)
  }
}
