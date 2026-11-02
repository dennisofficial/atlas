import { EBootStep, EBootStepState } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { seedThreadRow } from '../../../../test/session-seed'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import type { ArchivedSandboxSweepDeps } from './archived-sandbox-sweep'

export async function seedSweepSandboxRow(args: { threadId: string }): Promise<void> {
  const at = new Date('2026-10-20T00:00:00.000Z')
  await db.orm.public.CloudSandbox.create({
    id: `sbx_${args.threadId}`,
    sessionId: `ses_${args.threadId}`,
    userId: 'usr-1',
    sandboxId: '',
    name: `atlas-thread-${args.threadId}`,
    region: 'iad1',
    state: 'parked',
    lastActivityAt: at,
    tokenHash: `hash_${args.threadId}`,
    wakeClaim: at,
    createdAt: at,
    updatedAt: at,
  })
}

export async function recordApiBootStep(args: { threadId: string }): Promise<void> {
  await recordBootSteps({
    threadId: args.threadId,
    steps: [{ step: EBootStep.Provision, state: EBootStepState.Running }],
  })
}

export async function seedLocalLease(args: { threadId: string }): Promise<void> {
  const at = new Date('2026-10-20T00:00:00.000Z')
  await db.orm.public.LocalPodLease.create({
    userId: 'usr-1',
    threadId: args.threadId,
    tokenHash: `lease_${args.threadId}`,
    createdAt: at,
    updatedAt: at,
  })
}

export async function seedArchivedApiSession(args: {
  threadId?: string
  archivedAt: Date
  withSandbox?: boolean
  withBootSteps?: boolean
  withLease?: boolean
}): Promise<void> {
  const threadId = args.threadId ?? 'thr-1'
  await seedThreadRow({ id: threadId, userId: 'usr-1', archivedAt: args.archivedAt })
  if (args.withSandbox !== false) await seedSweepSandboxRow({ threadId })
  if (args.withBootSteps !== false) await recordApiBootStep({ threadId })
  if (args.withLease === true) await seedLocalLease({ threadId })
}

export function recordingSweepDeps(options: { deleteFails?: Error } = {}) {
  const deleted: Array<{ threadId: string; name: string }> = []
  const announced: string[] = []
  const logged: string[] = []
  const deps: ArchivedSandboxSweepDeps = {
    deleteSandbox: async (deleteArgs: { threadId: string; name: string }) => {
      if (options.deleteFails !== undefined) throw options.deleteFails
      deleted.push(deleteArgs)
    },
    podChanged: async (podArgs: { threadId: string }) => {
      announced.push(podArgs.threadId)
    },
    log: (line) => logged.push(line),
  }
  return { deps, deleted, announced, logged }
}
