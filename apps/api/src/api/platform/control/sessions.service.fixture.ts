import {
  composeCommands,
  defineCommand,
  ECommandGroup,
  ECommandRunsIn,
} from '@dltech/atlas-commands'
import { rename, resize } from '@dltech/atlas-native-commands'
import { chainEvents, toRunId, toThreadId, type RecordEventBody } from '@dltech/atlas-core'
import { z } from 'zod'
import { FakeMediaStore } from '@dltech/atlas-media/testing'
import type { ProductAnalytics, TracePort } from '@dltech/atlas-observability'
import { ControlPlane, INBOX_KIND_WITHDRAW, withdrawPayloadOf } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import type { PodOps } from '../../../agent'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { NoSessionTitler } from '../../../_core/ports/session-titler'
import { FakeMediaRegistry } from './media-registry.fake'
import { SessionsService } from './sessions.service'
import { PodPowerService } from './pod-power.service'
import { PodSizingService } from './pod-sizing.service'
import { JobsProjectDispatcher, type JobDispatch } from '../../../_core/ports/job-dispatcher'
import type { PreviewTeardownService } from '../previews/preview-teardown.service'
import { ProjectAccess } from './project-access'
import { modelSet } from './model-set'

export const RENAME_ARGS = z.strictObject({ title: z.string().min(1) })

export const TEST_COMMAND = defineCommand({
  spec: {
    name: 'test-rename',
    summary: 'a command only the specs know',
    group: ECommandGroup.Session,
    args: RENAME_ARGS,
    runsIn: ECommandRunsIn.Host,
  },
})

export const NOW = '2026-11-03T12:00:00.000Z'

export const appendBodies = async (args: {
  plane: ControlPlane
  threadId: string
  epoch: number
  bodies: readonly RecordEventBody[]
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

export const postedBody = (args: {
  inboxId: number
  text?: string
  kind?: string
}): RecordEventBody => ({
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

export class RecordingPreviewTeardown {
  readonly marked: { podSessionId: string }[] = []
  readonly cleared: { podSessionId: string }[] = []

  async markDeleting(args: { podSessionId: string }): Promise<void> {
    this.marked.push(args)
  }

  async clearDeleting(args: { podSessionId: string }): Promise<void> {
    this.cleared.push(args)
  }
}

export class FakePodResizeDispatcher {
  readonly dispatches: { payload: unknown; idempotencyKey: string }[] = []
  failure: unknown = undefined

  async dispatch(args: JobDispatch<never>): Promise<{ runId: string }> {
    if (this.failure !== undefined) throw this.failure
    this.dispatches.push({ payload: args.payload, idempotencyKey: args.idempotencyKey })
    return { runId: 'run_stub' }
  }
}

export const setupSessionsService = (
  over: {
    dispatcher?: FakePodResizeDispatcher
    ops?: PodOps | null
    analytics?: ProductAnalytics | null
    traceFor?: ((distinctId: string) => TracePort) | null
    previews?: RecordingPreviewTeardown | null
  } = {},
) => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  store.markHostPresent(9001)
  const plane = new ControlPlane({ store })
  const registry = new FakeMediaRegistry()
  const mediaStore = new FakeMediaStore()
  const projects = new RecordingProjectAccess()
  const dispatcher = over.dispatcher ?? new FakePodResizeDispatcher()
  const podSizing = new PodSizingService(plane, dispatcher as unknown as JobsProjectDispatcher)
  const podPower = new PodPowerService(plane, dispatcher as unknown as JobsProjectDispatcher)
  const service = new SessionsService(
    plane,
    projects,
    new NoSessionTitler(),
    new NoBackgroundWork(),
    registry,
    mediaStore,
    composeCommands([TEST_COMMAND, rename, modelSet, resize]),
    podSizing,
    podPower,
    dispatcher as unknown as JobsProjectDispatcher,
    over.ops ?? null,
    over.analytics ?? null,
    over.traceFor ?? null,
    (over.previews ?? null) as unknown as PreviewTeardownService | null,
  )
  return {
    plane,
    service,
    registry,
    mediaStore,
    store,
    projects,
    dispatcher,
    podPower,
    analytics: over.analytics ?? null,
  }
}
