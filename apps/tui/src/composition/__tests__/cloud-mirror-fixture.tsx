import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAgentStart,
  EExecutionLocation,
  stampEvent,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'
import {
  EClientRequest,
  JsonlEventLog,
  MirroredEventLog,
  SessionRegistry,
  SystemClock,
  mirrorWriter,
  transcriptIdentityDigest,
} from '@dltech/atlas-harness'

import { cloudChannelOf } from '../thread-view-refresh'
import type { OpenedConversation } from '../open-conversation'
import { promiseGate } from './app-fixture'
import { fakeIds } from './fake-backend'
import type { FakeApp } from './fake-app'
import { THREAD, wire } from './cloud-turn-state-fixture'

export const ASKED: EventDraft = { type: 'user-said', text: 'migrate the packages' }

export const CHILD: EventDraft = {
  type: 'agent-spawned',
  agentId: toThreadId('child-explorer'),
  agentType: 'explorer',
  intent: 'survey the packages',
  mode: EAgentStart.Fresh,
}

const toWire = (event: Event) => ({ ...event, body: JSON.stringify(event) })

const identityOf = (events: readonly Event[]) => ({
  count: events.length,
  digest: transcriptIdentityDigest(events),
})

export async function mirrored(args: {
  app: FakeApp
  seeded: readonly EventDraft[]
  hold: boolean
  inFlight: boolean
}) {
  const home = await mkdtemp(join(tmpdir(), 'atlas-mirror-resume-'))
  const local = new JsonlEventLog(home, new SessionRegistry(home), new SystemClock(), fakeIds())
  const before = await local.append({
    threadId: THREAD,
    runId: toRunId('run-before'),
    drafts: args.seeded,
  })
  const remote: Event[] = [...before]
  const wired = wire(args.app)
  const channel = cloudChannelOf(args.app)
  if (channel === null) throw new Error('the wired app has no cloud channel')

  const identity = { failure: null as string | null }
  channel.request = async ({ op, params }) => {
    if (identity.failure !== null) throw new Error(identity.failure)
    const query = params as { fromSeq?: number; upTo?: number }
    if (op === EClientRequest.ReadTranscriptIdentity) {
      return identityOf(remote.filter((event) => event.seq <= (query.upTo ?? Infinity)))
    }
    return {
      events: remote.filter((event) => event.seq > (query.fromSeq ?? 0)).map(toWire),
    }
  }
  wired.ready(args.inFlight)
  if (args.inFlight) wired.signal({ type: 'turn-working', working: true })

  const entered = promiseGate()
  const finish = promiseGate()
  const writer = mirrorWriter({ home: () => home })
  const log = new MirroredEventLog({
    channel,
    localLog: local,
    threadId: THREAD,
    writer: {
      ...writer,
      appendDelta: async (given) => {
        if (args.hold) {
          entered.release()
          await finish.gate
        }
        await writer.appendDelta(given)
      },
    },
  })
  Object.assign(args.app, { log })

  const opened: OpenedConversation = {
    threadId: THREAD,
    events: before,
    turns: [],
    name: null,
    started: true,
    executionLocation: EExecutionLocation.Cloud,
  }

  return {
    wired,
    opened,
    entered: entered.gate,
    release: finish.release,
    failIdentity: (message: string | null): void => {
      identity.failure = message
    },
    sandboxAppends: (draft: EventDraft): void => {
      const last = remote.at(-1)
      remote.push(
        stampEvent({
          draft,
          envelope: {
            id: toEventId(`remote-${remote.length + 1}`),
            seq: (last?.seq ?? 0) + 1,
            threadId: THREAD,
            runId: toRunId('run-remote'),
            depth: 0,
            at: new Date().toISOString(),
          },
        }),
      )
    },
    cleanup: async (): Promise<void> => {
      finish.release()
      await log.converge()
      await rm(home, { recursive: true, force: true })
    },
  }
}
