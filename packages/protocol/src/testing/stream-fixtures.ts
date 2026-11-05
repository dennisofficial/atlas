import { ESessionStatus } from '@dltech/atlas-core'

import {
  EStreamBlockKind,
  EStreamClearReason,
  EStreamErrorCode,
  EStreamResetReason,
  EStreamSubscribeKind,
  STREAM_PROTOCOL_VERSION,
  type StreamClientMessage,
  type StreamServerMessage,
} from '../stream'

export const streamStepKeyFixture = { runId: 'run-1', step: 3, attempt: 1 }

export const streamClientFixtures = {
  hello: { type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'token-abc' },
  subscribeSession: {
    type: 'subscribe',
    id: 'sub-1',
    kind: EStreamSubscribeKind.Session,
    sessionId: 'session-1',
    afterSeq: 412,
    afterHash: 'hash-412',
  },
  subscribeSessions: {
    type: 'subscribe',
    id: 'sub-2',
    kind: EStreamSubscribeKind.Sessions,
    projectId: 'project-1',
  },
  unsubscribe: { type: 'unsubscribe', id: 'sub-1' },
  resnap: { type: 'resnap', id: 'sub-1' },
  ping: { type: 'ping' },
} satisfies Record<string, StreamClientMessage>

const sessionRowFixture = {
  sessionId: 'session-1',
  projectId: 'project-1',
  title: 'Fix the build',
  status: ESessionStatus.Thinking,
  lastEventAt: '2026-11-05T10:00:00.000Z',
  headSeq: 540,
}

export const streamServerFixtures = {
  ready: { type: 'ready', v: STREAM_PROTOCOL_VERSION, connectionId: 'conn-1' },
  events: {
    type: 'events',
    id: 'sub-1',
    events: [{ seq: 413, type: 'user-said', text: 'hello' }],
    head: { seq: 413, hash: 'hash-413' },
    live: true,
  },
  reset: { type: 'reset', id: 'sub-1', reason: EStreamResetReason.Fork, tailFrom: 100 },
  view: {
    type: 'view',
    id: 'sub-1',
    name: 'status',
    at: 413,
    value: {
      state: ESessionStatus.Thinking,
      lease: { epoch: 1, holderHostId: 7, live: true },
    },
  },
  overlay: {
    type: 'overlay',
    id: 'sub-1',
    key: streamStepKeyFixture,
    blocks: [{ block: 'b0', kind: EStreamBlockKind.Text, text: 'Hel' }],
  },
  delta: {
    type: 'delta',
    id: 'sub-1',
    key: streamStepKeyFixture,
    block: 'b0',
    kind: EStreamBlockKind.Reasoning,
    from: 3,
    text: 'lo',
  },
  overlayClear: { type: 'overlay-clear', id: 'sub-1', reason: EStreamClearReason.HolderLost },
  frame: {
    type: 'frame',
    id: 'sub-1',
    frame: { type: 'tool-output', callId: 'call-1', text: 'ok' },
  },
  snapshot: { type: 'snapshot', id: 'sub-2', rows: [sessionRowFixture] },
  upsert: { type: 'upsert', id: 'sub-2', row: sessionRowFixture },
  remove: { type: 'remove', id: 'sub-2', sessionId: 'session-1' },
  error: { type: 'error', id: 'sub-1', code: EStreamErrorCode.NotFound },
  closing: { type: 'closing', code: 4401 },
  goingAway: { type: 'going-away', reconnectAfterMs: 2_500 },
  pong: { type: 'pong' },
} satisfies Record<string, StreamServerMessage>
