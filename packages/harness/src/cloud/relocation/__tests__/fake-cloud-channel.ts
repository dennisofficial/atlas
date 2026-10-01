import {
  EExecutionLocation,
  toRunId,
  type EventDraft,
  type SaidImage,
  type ThreadId,
} from '@dltech/atlas-core'
import type { RosterWire } from '@dltech/atlas-wire'

import {
  EClientRequest,
  readTranscriptIdentityParamsSchema,
  restoreTranscriptParamsSchema,
} from '../../channel-wire'
import { transcriptIdentityDigest } from '../../event-identity'
import { toThreadId } from '@dltech/atlas-core'
import {
  EChannelConnection,
  type ChannelConnection,
  type ChannelReady,
  type ChannelReload,
  type InterruptAck,
} from '../../remote-delta-channel'
import type { TurnOutcome } from '../../../loop/turn-outcome'
import type { CloudChannel, CloudReload } from '../cloud-bridge'
import { CLOUD_THREAD } from './cloud-fixture-ids'
import type { FakeEventLog } from './fake-event-log'

export type FakeCloudChannel = CloudChannel & {
  commitSaid(args: { text: string; images?: readonly SaidImage[] }): void
  moveTo(connection: ChannelConnection): void
  reload(reload: CloudReload): void
  ready(ready: ChannelReady): void
  fail(message: string): void
  failTransport(message: string): void
  acknowledgeInterrupt(): void
  pushRoster(roster: RosterWire): void
  endTurn(outcome: TurnOutcome): void
  readonly closed: boolean
  readonly runs: number
  readonly sent: readonly {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }[]
  readonly requests: readonly { op: EClientRequest; params: unknown }[]
  readonly woken: readonly { url: string; token: string }[]
}

export function fakeCloudChannel(
  args: {
    threadId?: ThreadId
    log?: FakeEventLog | undefined
    archive?: string | undefined
    memoryArchive?: string | undefined
    restoreTranscriptRefused?: boolean | undefined
    applyTranscript?: (() => Promise<void>) | undefined
  } = {},
): FakeCloudChannel {
  const connections = new Set<(connection: ChannelConnection) => void>()
  const reloads = new Set<(reload: CloudReload) => void>()
  const readies = new Set<(ready: ChannelReady) => void>()
  const failures = new Set<(failure: { message: string }) => void>()
  const serverErrors = new Set<(failure: { message: string }) => void>()
  const interruptAcks = new Set<(ack: InterruptAck) => void>()
  const rosters = new Set<(roster: RosterWire) => void>()
  const turnEndings = new Set<(outcome: TurnOutcome) => void>()
  const woken: { url: string; token: string }[] = []
  const requests: { op: EClientRequest; params: unknown }[] = []
  const sent: {
    text: string
    images?: readonly SaidImage[]
    context?: readonly EventDraft[]
  }[] = []

  let held: ChannelConnection = {
    state: EChannelConnection.Connecting,
    detail: null,
  }
  let heldRoster: RosterWire = { shells: [], agents: [], services: [] }
  let closed = false
  let runs = 0

  return {
    threadId: args.threadId ?? CLOUD_THREAD,
    commitSaid: ({ text, images }) => {
      const threadId = args.threadId ?? CLOUD_THREAD
      void args.log?.append({
        threadId,
        runId: toRunId(`serve-${threadId}`),
        drafts: [
          {
            type: 'user-said',
            text,
            ...(images === undefined ? {} : { images }),
          },
        ],
      })
    },
    subscribe: () => () => undefined,
    snapshot: () => [],
    publisherFor: () => {
      throw new Error('a cloud channel never publishes from the client')
    },
    send: (said) => {
      sent.push({
        text: said.text,
        ...(said.images === undefined ? {} : { images: said.images }),
        ...(said.context === undefined ? {} : { context: said.context }),
      })
    },
    run: () => {
      runs += 1
    },
    interrupt: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    request: async (given) => {
      requests.push({ op: given.op, params: given.params })
      if (given.op === EClientRequest.ReadTranscriptIdentity) {
        const params = readTranscriptIdentityParamsSchema.parse(given.params)
        const events =
          (await args.log?.readOwn({
            threadId: toThreadId(params.threadId),
            ...(params.upTo === undefined ? {} : { upTo: params.upTo }),
          })) ?? []
        return { count: events.length, digest: transcriptIdentityDigest(events) }
      }
      if (given.op === EClientRequest.ListRoster) return heldRoster
      if (given.op === EClientRequest.PublishWorkspace) return null
      if (given.op === EClientRequest.Rewind) return { applied: 0 }
      if (given.op === EClientRequest.ReadSessionArchive) return { archive: args.archive ?? '' }
      if (given.op === EClientRequest.ReadMemoryArchive)
        return { archive: args.memoryArchive ?? '' }
      if (given.op === EClientRequest.RestoreTranscript) {
        if (args.restoreTranscriptRefused === true)
          throw new Error('unknown request op: restore-transcript')
        await args.applyTranscript?.()
        // Mirror the serve's restore: pin the lift's location-changed marker on the sandbox log.
        const params = restoreTranscriptParamsSchema.safeParse(given.params ?? {})
        const marker = params.success ? params.data.locationChanged : undefined
        const threadId = args.threadId ?? CLOUD_THREAD
        if (marker !== undefined && args.log !== undefined) {
          const existing = await args.log.readOwn({ threadId })
          const last = existing.at(-1)
          if (!(last?.type === 'location-changed' && last.to === marker.to)) {
            await args.log.append({
              threadId,
              runId: toRunId(`serve-${threadId}`),
              drafts: [
                {
                  type: 'location-changed',
                  from: marker.from as EExecutionLocation,
                  to: marker.to as EExecutionLocation,
                  ...(marker.cwd === undefined ? {} : { cwd: marker.cwd }),
                  ...(marker.remoteUrl === undefined ? {} : { remoteUrl: marker.remoteUrl }),
                  ...(marker.branch === undefined ? {} : { branch: marker.branch }),
                },
              ],
            })
          }
        }
        return { restored: true }
      }
      return { applied: 0 }
    },
    connection: () => held,
    onConnection: (listener) => {
      connections.add(listener)
      return () => {
        connections.delete(listener)
      }
    },
    onReload: (listener) => {
      reloads.add(listener)
      return () => {
        reloads.delete(listener)
      }
    },
    onReady: (listener) => {
      readies.add(listener)
      return () => {
        readies.delete(listener)
      }
    },
    onTurnEnded: (listener) => {
      turnEndings.add(listener)
      return () => {
        turnEndings.delete(listener)
      }
    },
    onError: (listener) => {
      failures.add(listener)
      return () => {
        failures.delete(listener)
      }
    },
    onServerError: (listener) => {
      serverErrors.add(listener)
      return () => {
        serverErrors.delete(listener)
      }
    },
    onInterruptAck: (listener) => {
      interruptAcks.add(listener)
      return () => {
        interruptAcks.delete(listener)
      }
    },
    onRoster: (listener) => {
      rosters.add(listener)
      return () => {
        rosters.delete(listener)
      }
    },
    onThreadRenamed: () => () => undefined,
    onThreadModelChanged: () => () => undefined,
    pendingEntries: () => [],
    onPendingChanged: () => () => undefined,
    wake: ({ url, token }) => {
      woken.push({ url, token })
    },
    reconnect: () => undefined,
    close: () => {
      closed = true
    },

    get closed() {
      return closed
    },

    get runs() {
      return runs
    },

    get sent() {
      return sent
    },

    get woken() {
      return woken
    },

    moveTo(connection) {
      held = connection
      for (const listener of [...connections]) listener(connection)
    },
    reload(reload) {
      for (const listener of [...reloads]) listener(reload)
    },
    requests,
    ready(ready) {
      for (const listener of [...readies]) listener(ready)
    },
    fail(message) {
      for (const listener of [...failures]) listener({ message })
      for (const listener of [...serverErrors]) listener({ message })
    },
    failTransport(message) {
      for (const listener of [...failures]) listener({ message })
    },
    acknowledgeInterrupt() {
      for (const listener of [...interruptAcks]) listener({ turnInFlight: true })
    },
    pushRoster(roster: RosterWire) {
      heldRoster = roster
      for (const listener of [...rosters]) listener(roster)
    },
    endTurn(outcome) {
      for (const listener of [...turnEndings]) listener(outcome)
    },
  }
}
