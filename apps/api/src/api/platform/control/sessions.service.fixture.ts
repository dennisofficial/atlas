import { composeCommands, defineCommand } from '@dltech/atlas-commands'
import { resize } from '@dltech/atlas-native-commands'
import {
  chainEvents,
  ECommandGroup,
  ECommandTiming,
  toRunId,
  toThreadId,
  type V2Body,
} from '@dltech/atlas-core'
import { z } from 'zod'
import { FakeMediaStore } from '@dltech/atlas-media/testing'
import { ControlPlane, INBOX_KIND_WITHDRAW, withdrawPayloadOf } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { EnvService } from '../../../_core/config/env/env.service'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { PodPlanGate } from '../../../_core/ports/pod-plan-gate'
import { NoSessionTitler } from '../../../_core/ports/session-titler'
import { FakeMediaRegistry } from './media-registry.fake'
import { SessionsService } from './sessions.service'
import { PodSizingService } from './pod-sizing.service'
import type {
  SandboxResourcesObservation,
  VercelSandboxClient,
} from '../sandboxes/vercel-sandbox.client'
import { ProjectAccess } from './project-access'
import { modelSet } from './model-set'

export const RENAME_ARGS = z.strictObject({ title: z.string().min(1) })

export const TEST_COMMAND = defineCommand({
  spec: {
    name: 'test-rename',
    summary: 'a command only the specs know',
    group: ECommandGroup.Session,
    args: RENAME_ARGS,
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})

export const NOW = '2026-11-03T12:00:00.000Z'

export const appendBodies = async (args: {
  plane: ControlPlane
  threadId: string
  epoch: number
  bodies: readonly V2Body[]
}): Promise<void> => {
  const outcome = await args.plane.append({
    threadId: args.threadId,
    epoch: args.epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-1'),
      epoch: args.epoch,
      at: NOW,
      bodies: args.bodies,
      from: await args.plane.head({ threadId: args.threadId }),
    }),
  })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
}

export const postedBody = (args: { inboxId: number; text?: string; kind?: string }): V2Body => ({
  type: 'input-posted',
  inboxId: args.inboxId,
  kind: args.kind ?? 'message',
  postedAt: NOW,
  ...(args.text === undefined ? {} : { text: args.text }),
})

class RecordingProjectAccess extends ProjectAccess {
  readonly ownerLookups: string[] = []

  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    this.ownerLookups.push(args.projectId)
    return args.projectId === 'proj-a' ? 'user-a' : undefined
  }
}

class NoBackgroundWork extends BackgroundWork {
  keepAlive(): void {}
}

export const logWithdrawn = async (args: {
  plane: ControlPlane
  sessionId: string
  threadId: string
  epoch: number
  inboxId: number
  text: string
}): Promise<void> => {
  const staged = (
    await args.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 100 })
  ).find(
    (entry) =>
      entry.kind === INBOX_KIND_WITHDRAW &&
      withdrawPayloadOf(entry.payload)?.targetInboxId === args.inboxId,
  )
  if (staged === undefined) throw new Error('no staged withdraw')
  await appendBodies({
    plane: args.plane,
    threadId: args.threadId,
    epoch: args.epoch,
    bodies: [
      postedBody({ inboxId: args.inboxId, text: args.text }),
      { type: 'input-withdrawn', inboxId: args.inboxId, requestInboxId: staged.inboxId },
    ],
  })
}

export class FakePodSizingClient {
  readonly reads: { userId: string; name: string }[] = []
  readonly resizes: { userId: string; name: string; vcpus: number }[] = []
  resources: SandboxResourcesObservation | null = null
  failure: unknown = undefined

  async readPodResources(args: {
    userId: string
    name: string
  }): Promise<SandboxResourcesObservation | null> {
    this.reads.push(args)
    if (this.failure !== undefined) throw this.failure
    return this.resources
  }

  async resizePod(args: { userId: string; name: string; vcpus: number }): Promise<void> {
    this.resizes.push(args)
    if (this.failure !== undefined) throw this.failure
  }
}

export const setupSessionsService = (
  over: { env?: Record<string, string>; planGate?: PodPlanGate; client?: FakePodSizingClient } = {},
) => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  store.markHostPresent(9001)
  const plane = new ControlPlane({ store })
  const registry = new FakeMediaRegistry()
  const mediaStore = new FakeMediaStore()
  const projects = new RecordingProjectAccess()
  const planGate: PodPlanGate = over.planGate ?? { assertWithinPlan: async () => undefined }
  const client = over.client ?? new FakePodSizingClient()
  const podSizing = new PodSizingService(
    client as unknown as VercelSandboxClient,
    new NoBackgroundWork(),
    planGate,
  )
  const service = new SessionsService(
    plane,
    projects,
    new NoSessionTitler(),
    new NoBackgroundWork(),
    registry,
    mediaStore,
    composeCommands([TEST_COMMAND, modelSet, resize]),
    new EnvService({ SANDBOX_PROVIDER_DEFAULT: 'vercel', ...over.env }),
    podSizing,
  )
  return { plane, service, registry, mediaStore, store, projects, client }
}
