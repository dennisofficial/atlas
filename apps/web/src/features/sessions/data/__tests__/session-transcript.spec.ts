import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  toCallId,
  toRunId,
  toThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'
import { overlayStepOf, runKey, tailRunOfSteps } from '@dltech/atlas-client/transcript'
import { EBlockKind } from '@dltech/atlas-core'
import { EStreamBlockKind } from '@dltech/atlas-protocol'

import { ETranscriptKind } from '@/features/threads/data/transcript-kind'

import { sessionTranscriptOf } from '../session-transcript'

describe('a message from another session', () => {
  const peerSaid = (session: string): V2Body[] => [
    { type: 'user-said', text: 'second reply ok', sender: { session }, via: 'peer-agent' as never },
  ]

  it('names the session that sent it, rather than showing its id', () => {
    const view = sessionTranscriptOf({
      events: mint(peerSaid('ses_2')),
      overlay: undefined,
      sessionNameOf: (id) => (id === 'ses_2' ? 'Fix login' : undefined),
    })
    const row = view.items[0]
    expect(row.kind).toBe(ETranscriptKind.Notice)
    expect(row.kind === ETranscriptKind.Notice ? row.title : '').toBe('Message from Fix login')
  })

  it('never falls back to a raw id when the session is unknown', () => {
    const view = sessionTranscriptOf({
      events: mint(peerSaid('ses_2')),
      overlay: undefined,
      sessionNameOf: () => undefined,
    })
    const row = view.items[0]
    expect(row.kind === ETranscriptKind.Notice ? row.title : '').toBe(
      'Message from another session',
    )
  })
})

const call = toCallId('call-1')

const mint = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-05T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const snapshotOf = (params: Partial<SessionSnapshot>): SessionSnapshot => ({
  events: [],
  cursor: undefined,
  status: undefined,
  overlay: undefined,
  connection: ESessionConnection.Live,
  error: undefined,
  ...params,
})

const shapeOf = (snapshot: SessionSnapshot) =>
  sessionTranscriptOf(snapshot).items.map((item) => {
    if (item.kind === ETranscriptKind.Tools) {
      return [item.kind, item.calls.map((toolCall) => toolCall.label)]
    }
    if (item.kind === ETranscriptKind.User || item.kind === ETranscriptKind.Agent) {
      return [item.kind, item.text]
    }
    return [item.kind]
  })

describe('sessionTranscriptOf', () => {
  it('is empty for an empty session', () => {
    expect(sessionTranscriptOf(snapshotOf({})).items).toEqual([])
  })

  it('renders user messages, replies and tool runs from the event log', () => {
    const events = mint([
      { type: 'user-said', text: 'list files' },
      {
        type: 'tool-called',
        callId: call,
        name: 'bash',
        input: { command: 'ls' },
        ordinal: 0,
      },
      { type: 'tool-dispatched', callId: call, name: 'bash' },
      { type: 'tool-result', callId: call, name: 'bash', output: 'a.txt' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'One file.' }] },
    ])

    expect(shapeOf(snapshotOf({ events }))).toEqual([
      [ETranscriptKind.User, 'list files'],
      [ETranscriptKind.Tools, ['ls']],
      [ETranscriptKind.Agent, 'One file.'],
    ])
  })

  it('appends the open overlay as a streaming reply', () => {
    const events = mint([{ type: 'user-said', text: 'hi' }])
    const view = sessionTranscriptOf(
      snapshotOf({
        events,
        overlay: {
          key: { runId: 'run-1', step: 1, attempt: 0 },
          afterSeq: 1,
          blocks: [{ block: 't0', kind: EStreamBlockKind.Text, text: 'Hel' }],
          ended: false,
        },
      }),
    )

    expect(view.streaming).toBe(true)
    const last = view.items[view.items.length - 1]
    expect(last?.kind).toBe(ETranscriptKind.Agent)
    expect(last?.kind === ETranscriptKind.Agent && [last.text, last.streaming]).toEqual([
      'Hel',
      true,
    ])
  })

  it('stops streaming once the overlay step has ended', () => {
    const view = sessionTranscriptOf(
      snapshotOf({
        events: mint([{ type: 'user-said', text: 'hi' }]),
        overlay: {
          key: { runId: 'run-1', step: 1, attempt: 0 },
          afterSeq: 1,
          blocks: [{ block: 't0', kind: EStreamBlockKind.Text, text: 'Hello' }],
          ended: true,
        },
      }),
    )

    expect(view.streaming).toBe(false)
  })

  it('shows reasoning deltas as a live thinking row', () => {
    const view = sessionTranscriptOf(
      snapshotOf({
        events: mint([{ type: 'user-said', text: 'hi' }]),
        overlay: {
          key: { runId: 'run-1', step: 1, attempt: 0 },
          afterSeq: 1,
          blocks: [
            {
              block: 'r0',
              kind: EStreamBlockKind.Reasoning,
              text: 'Weighing options',
            },
          ],
          ended: false,
        },
      }),
    )

    const last = view.items[view.items.length - 1]
    expect(last?.kind === ETranscriptKind.Thought && [last.text, last.streaming]).toEqual([
      'Weighing options',
      true,
    ])
  })

  it('renders a recorded reasoning part as a settled thought', () => {
    const view = sessionTranscriptOf(
      snapshotOf({
        events: mint([
          { type: 'user-said', text: 'hi' },
          {
            type: 'assistant-said',
            parts: [
              { type: 'reasoning', text: 'Considered it.' },
              { type: 'text', text: 'Done.' },
            ],
          },
        ]),
      }),
    )

    const thought = view.items.find((item) => item.kind === ETranscriptKind.Thought)
    expect(thought?.kind === ETranscriptKind.Thought && [thought.text, thought.streaming]).toEqual([
      'Considered it.',
      false,
    ])
  })

  it('reveals only the gated prefix of the streaming reply', () => {
    const overlay = {
      key: { runId: 'run-1', step: 1, attempt: 0 },
      afterSeq: 1,
      blocks: [{ block: 't0', kind: EStreamBlockKind.Text, text: 'Hello world' }],
      ended: false,
    }
    const [step] = overlayStepOf(overlay)
    if (step === undefined) throw new Error('overlay produced no step')
    const key = runKey({
      stepId: step.stepId,
      kind: EBlockKind.Text,
      id: 't0',
    })

    expect(tailRunOfSteps({ steps: [step], events: [] })).toEqual({
      key,
      text: 'Hello world',
    })

    const view = sessionTranscriptOf({
      ...snapshotOf({
        events: mint([{ type: 'user-said', text: 'hi' }]),
        overlay,
      }),
      reveal: { key, revealed: 5 },
    })
    const last = view.items[view.items.length - 1]
    expect(last?.kind === ETranscriptKind.Agent && last.text).toBe('Hello')
  })

  it('carries an upload of a user message as an attachment on its item', () => {
    const upload = {
      uploadId: '11111111-1111-4111-8111-111111111111',
      pathname: 'composer-uploads/user-1/11111111-1111-4111-8111-111111111111/deploy.sh',
      name: 'deploy.sh',
      size: 12,
      mediaType: 'application/x-sh',
    }
    const events = mint([{ type: 'user-said', text: 'run it', uploads: [upload] }])

    const [item] = sessionTranscriptOf(snapshotOf({ events })).items

    expect(item?.kind === ETranscriptKind.User && item.attachments).toMatchObject([
      { id: upload.uploadId, name: 'deploy.sh', content: { store: 'upload' } },
    ])
  })

  it('shows an MCP sign-in as a row of its own, settled into signed in', () => {
    const events = mint([
      {
        type: 'mcp-sign-in-started',
        server: 'posthog',
        url: 'https://provider.test/authorize?client_id=c',
        expiresAt: '2026-11-05T10:10:00.000Z',
        sessionId: 's1',
      },
      { type: 'mcp-sign-in-resolved', server: 'posthog', result: 'connected', sessionId: 's1' },
    ])

    const [item] = sessionTranscriptOf(snapshotOf({ events })).items

    expect(item).toMatchObject({
      kind: ETranscriptKind.SignIn,
      subject: 'posthog',
      result: 'connected',
      text: 'signed in to the posthog MCP server',
    })
  })

  it('keeps a sign-in row live until its resolution lands', () => {
    const events = mint([
      {
        type: 'mcp-sign-in-started',
        server: 'posthog',
        url: 'https://provider.test/authorize?client_id=c',
        sessionId: 's1',
      },
    ])

    const [item] = sessionTranscriptOf(snapshotOf({ events })).items

    expect(item).toMatchObject({
      kind: ETranscriptKind.SignIn,
      subject: 'posthog',
      url: 'https://provider.test/authorize?client_id=c',
    })
  })
})
