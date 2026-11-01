import { db } from '@dltech/atlas-db'
import { spyOn } from 'bun:test'
import { seedSandboxRow, seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { EnvService } from '../../../_core/config/env/env.service'
import { JobDispatcher, type AnyTask, type JobDispatch } from '../../../_core/ports/job-dispatcher'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { DrainStateService } from '../health/drain-state.service'
import { CloudflareTunnelClient } from '../sandboxes/cloudflare-tunnel.client'
import { PreviewTunnelService } from '../sandboxes/preview-tunnel.service'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { VercelSandboxClient } from '../sandboxes/vercel-sandbox.client'
import {
  THREAD_ARCHIVE_CLEANUP_TASK_ID,
  threadArchiveCleanupPayloadSchema,
  type ThreadArchiveCleanupPayload,
} from './thread-archive-cleanup.contract'
import {
  runThreadArchiveCleanup,
  type ThreadArchiveCleanupDeps,
} from './thread-archive-cleanup-run'
import { ThreadArchiveService } from './thread-archive.service'
import { ThreadSignalsService } from './thread-signals.service'
import { createSessionsRouterApp, USER_ID } from './threads-routers.fixture'

class ArchiveCleanupQueue extends JobDispatcher {
  readonly calls: { payload: ThreadArchiveCleanupPayload; idempotencyKey: string }[] = []

  constructor(private readonly deps: ThreadArchiveCleanupDeps) {
    super()
  }

  async dispatch<TTask extends AnyTask>(args: JobDispatch<TTask>): Promise<{ runId: string }> {
    if (args.task.id !== THREAD_ARCHIVE_CLEANUP_TASK_ID) throw new Error('unexpected task')
    const payload = threadArchiveCleanupPayloadSchema.parse(args.task.schema.parse(args.payload))
    this.calls.push({ payload, idempotencyKey: args.idempotencyKey })
    return { runId: `archive-run-${this.calls.length}` }
  }

  async runNext() {
    const call = this.calls.shift()
    if (call === undefined) throw new Error('no archive cleanup dispatched')
    return runThreadArchiveCleanup({ payload: call.payload, deps: this.deps })
  }
}

export async function createArchiveRouterFixture() {
  const env = new EnvService({ SECRETS_ENCRYPTION_KEY: '0'.repeat(64) })
  const cipher = new SecretCipherService(env)
  const signals = new ThreadSignalsService(new DrainStateService())
  const vercel = new VercelSandboxClient({
    async forThread() {
      throw new Error('unexpected Vercel credentials lookup')
    },
  })
  const stop = spyOn(vercel, 'stop').mockResolvedValue(undefined)
  const notifyParked = spyOn(vercel, 'notifyParked').mockResolvedValue(undefined)
  const cloudflare = new CloudflareTunnelClient(env)
  const deleteDnsRecord = spyOn(cloudflare, 'deleteDnsRecord').mockResolvedValue(undefined)
  const deleteTunnel = spyOn(cloudflare, 'deleteTunnel').mockResolvedValue(undefined)
  const previews = new PreviewTunnelService(env, cipher, cloudflare)
  const sandboxes = new SandboxesService(vercel, cipher, signals)
  const dispatcher = new ArchiveCleanupQueue({
    park: (args) => sandboxes.park(args),
    teardownPreviews: (args) => previews.teardown(args),
  })
  const app = await createSessionsRouterApp({
    archive: new ThreadArchiveService(dispatcher, signals),
    signals,
  })
  return {
    app,
    dispatcher,
    stop,
    notifyParked,
    deleteDnsRecord,
    deleteTunnel,
    async close() {
      await signals.changesSettled()
      await app.close()
      stop.mockRestore()
      notifyParked.mockRestore()
      deleteDnsRecord.mockRestore()
      deleteTunnel.mockRestore()
    },
  }
}

export async function seedArchiveFamily() {
  await seedUsers(USER_ID)
  const manager = await seedThreadRow({ id: 'manager', userId: USER_ID })
  const child = await seedThreadRow({
    id: 'child',
    userId: USER_ID,
    managedBySessionId: manager.sessionId,
  })
  const sibling = await seedThreadRow({
    id: 'sibling',
    userId: USER_ID,
    managedBySessionId: manager.sessionId,
  })
  const nested = await seedThreadRow({
    id: 'nested',
    userId: USER_ID,
    managedBySessionId: child.sessionId,
  })
  const managerSandbox = await seedSandboxRow({ threadId: manager.id, userId: USER_ID })
  const siblingSandbox = await seedSandboxRow({ threadId: sibling.id, userId: USER_ID })
  const managerPreview = await seedArchivePreview({ threadId: manager.id })
  return { manager, child, sibling, nested, managerSandbox, siblingSandbox, managerPreview }
}

export async function seedArchivePreview(args: { threadId: string }) {
  const tunnel = await db.orm.public.PreviewTunnel.create({
    userId: USER_ID,
    threadId: args.threadId,
    tunnelId: `tunnel-${args.threadId}`,
    sealedTunnelToken: 'sealed-token',
    label: `preview-${args.threadId}`,
  })
  await db.orm.public.PreviewRoute.create({
    previewTunnelId: tunnel.id,
    port: 3000,
    hostname: `${args.threadId}.byatlas.dev`,
    dnsRecordId: `dns-${args.threadId}`,
  })
  return tunnel
}
