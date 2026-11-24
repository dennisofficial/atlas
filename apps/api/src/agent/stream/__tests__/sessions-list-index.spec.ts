import { describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'
import { EStreamSurface, STREAM_PROTOCOL_VERSION } from '@dltech/atlas-protocol'

import type { FollowDeps, FollowPlane } from '../follow-types'
import { SessionsListIndex } from '../sessions-list'
import { SessionsSubscription } from '../sessions-subscription'
import type { OutgoingFrame, SubscriptionConnection } from '../subscription-port'
import { FakeTimers } from './fake-timers'

const NOW = '2026-11-06T12:00:00.000Z'
const OWNER = 'user-a'
const SESSION = 'session-1'
const THREAD = 'thread-1'

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }

  errors(): LogEntry[] {
    return this.entries.filter((entry) => entry.severity === ELogSeverity.Error)
  }
}

const rig = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store, clock: () => NOW })
  await plane.createSession({
    sessionId: SESSION,
    userId: OWNER,
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  let failing = false
  const followPlane: FollowPlane = {
    readSession: (params) => plane.readSession(params),
    readThread: (params) => plane.readThread(params),
    head: (params) => plane.head(params),
    readEvents: (params) => plane.readEvents(params),
    readSessionView: (params) => plane.readSessionView(params),
    readTailBase: (params) => plane.readTailBase(params),
    listSessionDigests: (params) => {
      if (failing && params.sessionId === SESSION) {
        return Promise.reject(new Error('recompute exploded'))
      }
      return plane.listSessionDigests(params)
    },
  }
  const log = new RecordingLog()
  const deps: FollowDeps = { plane: followPlane, timers: new FakeTimers(), log }
  const index = new SessionsListIndex(deps)
  const sent: OutgoingFrame[] = []
  const ended: string[] = []
  const connection: SubscriptionConnection = {
    userId: OWNER,
    version: STREAM_PROTOCOL_VERSION,
    surface: EStreamSurface.Web,
    send: (message) => sent.push(message),
    bufferedAmount: () => 0,
    sentBytes: () => 0,
    close: () => undefined,
  }
  const subscription = new SessionsSubscription({
    id: 'list',
    projectId: undefined,
    connection,
    index,
    onEnded: (target) => ended.push(target.id),
  })
  const frames = <T extends OutgoingFrame['type']>(
    type: T,
  ): Extract<OutgoingFrame, { type: T }>[] =>
    sent.filter((message): message is Extract<OutgoingFrame, { type: T }> => message.type === type)
  return {
    index,
    subscription,
    log,
    frames,
    ended,
    failRecompute: (value: boolean) => {
      failing = value
    },
    post: (text: string) =>
      plane.post({
        sessionId: SESSION,
        kind: 'message',
        payload: JSON.stringify({ text, via: 'operator' }),
      }),
  }
}

describe('sessions list index', () => {
  it('keeps the user subscription open when one session fails to recompute', async () => {
    const { index, subscription, log, frames, ended, failRecompute, post } = await rig()
    await subscription.begin()
    expect(frames('snapshot')).toHaveLength(1)
    failRecompute(true)
    await index.refresh(SESSION)
    expect(ended).toEqual([])
    expect(frames('error')).toHaveLength(0)
    expect(log.errors().map((entry) => entry.data?.sessionId)).toEqual([SESSION])
    failRecompute(false)
    await post('a first message')
    await index.refresh(SESSION)
    expect(frames('upsert')).toHaveLength(1)
    expect(ended).toEqual([])
  })
})
