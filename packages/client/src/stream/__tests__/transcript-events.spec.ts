import { describe, expect, it } from 'bun:test'
import { ECompactionAnchor, toCallId, type V2Body } from '@dltech/atlas-core'

import { runLabel } from '../../transcript/tools'
import { durableEntries } from '../../transcript/durable-entries'
import { EEntryKind, type TranscriptEntry } from '../../transcript/transcript-model'
import { log } from '../../transcript/__tests__/fixture'
import { applyPage, EMPTY_WINDOW } from '../session-window'
import { transcriptEventsOf } from '../transcript-events'
import { headOf, mintEvents } from './support'

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'probe-observed': { type: 'probe-observed'; label: string }
  }
}

const call = toCallId('call-1')

const said = (text: string): V2Body => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const toolBodies = (params: { input?: unknown; output?: unknown }): V2Body[] => [
  { type: 'tool-called', callId: call, name: 'bash', input: params.input, ordinal: 1 },
  { type: 'tool-dispatched', callId: call, name: 'bash' },
  { type: 'tool-result', callId: call, name: 'bash', output: params.output },
]

const blobRef = (preview: string) => ({
  $blob: { hash: 'a'.repeat(64), size: 300_000, preview },
})

const shape = (entries: readonly TranscriptEntry[]) =>
  entries.map((entry) =>
    entry.kind === EEntryKind.ToolsRan
      ? [
          entry.kind,
          entry.run.calls.map((toolCall) => [toolCall.name, toolCall.state, toolCall.output]),
        ]
      : [entry.kind, entry.text],
  )

describe('transcriptEventsOf', () => {
  it('folds a chained v2 log into the entries the equivalent v1 log gives', () => {
    const v2 = mintEvents({
      bodies: [
        { type: 'user-said', text: 'run it' },
        { type: 'input-consumed', inboxId: 1 },
        said('on it'),
        ...toolBodies({ input: { command: 'ls' }, output: { stdout: 'a' } }),
        { type: 'fact-recorded', key: 'k', kind: 'note' },
        said('done'),
      ],
    })
    const v1 = log([
      { type: 'user-said', text: 'run it' },
      said('on it'),
      ...toolBodies({ input: { command: 'ls' }, output: { stdout: 'a' } }),
      said('done'),
    ] as Parameters<typeof log>[0])

    const fromV2 = durableEntries({ events: transcriptEventsOf(v2) })

    expect(shape(fromV2)).toEqual(shape(durableEntries({ events: v1 })))
    expect(fromV2.map((entry) => entry.kind)).toEqual([
      EEntryKind.OperatorSaid,
      EEntryKind.ModelSaid,
      EEntryKind.ToolsRan,
      EEntryKind.ModelSaid,
    ])
  })

  it('drops record-only events and strips the chain fields', () => {
    const events = mintEvents({
      bodies: [
        { type: 'user-said', text: 'hi' },
        { type: 'history-rewound', toSeq: 0 },
        { type: 'input-consumed', inboxId: 1 },
        { type: 'fact-recorded', key: 'k', kind: 'note' },
      ],
    })

    const [only, ...rest] = transcriptEventsOf(events)

    expect(rest).toEqual([])
    expect(only).toBeDefined()
    expect(only).not.toHaveProperty('epoch')
    expect(only).not.toHaveProperty('prevHash')
    expect(only).toMatchObject({ id: 'thread-1:1', seq: 1, threadId: 'thread-1', depth: 0 })
  })

  it('turns a summarised range into one history-compacted entry', () => {
    const events = mintEvents({
      bodies: [
        { type: 'user-said', text: 'one' },
        said('two'),
        {
          type: 'history-summarised',
          fromSeq: 1,
          throughSeq: 2,
          anchor: ECompactionAnchor.Prefix,
          summary: 'they talked',
        },
      ],
    })

    const mapped = transcriptEventsOf(events)
    const compacted = mapped.filter((event) => event.type === 'history-compacted')

    expect(compacted).toHaveLength(1)
    expect(compacted[0]).toMatchObject({
      anchor: ECompactionAnchor.Prefix,
      fromSeq: 1,
      throughSeq: 2,
      summary: 'they talked',
      replaced: 2,
    })
    expect(
      durableEntries({ events: mapped }).filter(
        (entry) => entry.kind === EEntryKind.HistoryCompacted,
      ),
    ).toHaveLength(1)
  })

  it('shows nothing past the rewind point once the window has applied visibility', () => {
    const events = mintEvents({
      bodies: [
        { type: 'user-said', text: 'keep' },
        said('kept'),
        { type: 'user-said', text: 'undone' },
        said('undone too'),
        { type: 'history-rewound', toSeq: 2 },
      ],
    })
    const window = applyPage({
      window: EMPTY_WINDOW,
      page: { events: events.map((event) => ({ ...event })), head: headOf(events) },
    })

    const entries = durableEntries({ events: transcriptEventsOf(window.events) })

    expect(entries.map((entry) => entry.text)).toEqual(['keep', 'kept'])
  })

  it('renders a blob-ref output as its preview', () => {
    const events = mintEvents({
      bodies: [
        { type: 'user-said', text: 'go' },
        ...toolBodies({ input: { command: 'cat big' }, output: blobRef('first 2 KiB') }),
      ],
    })

    const entries = durableEntries({ events: transcriptEventsOf(events) })
    const ran = entries.find((entry) => entry.kind === EEntryKind.ToolsRan)

    expect(ran?.kind === EEntryKind.ToolsRan && ran.run.calls[0]?.output).toBe('first 2 KiB')
  })

  it('removes a blob-ref input so labelling the call does not throw', () => {
    const events = mintEvents({
      bodies: toolBodies({ input: blobRef('{"command":"…'), output: { stdout: '' } }),
    })

    const mapped = transcriptEventsOf(events)
    const called = mapped.find((event) => event.type === 'tool-called')
    const ran = durableEntries({ events: mapped }).find(
      (entry) => entry.kind === EEntryKind.ToolsRan,
    )

    expect(called).not.toHaveProperty('input')
    expect(ran?.kind === EEntryKind.ToolsRan && typeof runLabel(ran.run.calls)).toBe('string')
  })

  it('ignores a body no plugin on this client knows', () => {
    const events = mintEvents({
      bodies: [
        { type: 'user-said', text: 'hi' },
        { type: 'probe-observed', label: 'x' },
        { type: 'assistant-said', parts: [{ type: 'text', text: 'there' }] },
      ],
    })

    expect(transcriptEventsOf(events).map((event) => event.type)).toEqual([
      'user-said',
      'assistant-said',
    ])
  })

  it('carries an event whose type a registered plugin named', () => {
    const events = mintEvents({
      bodies: [
        { type: 'user-said', text: 'hi' },
        { type: 'probe-observed', label: 'x' },
      ],
    })

    expect(
      transcriptEventsOf(events, new Set(['probe-observed'])).map((event) => `${event.type}`),
    ).toEqual(['user-said', 'probe-observed'])
  })

  it('passes a plain object input and output through untouched', () => {
    const events = mintEvents({
      bodies: toolBodies({ input: { command: 'ls' }, output: { stdout: 'a' } }),
    })

    const mapped = transcriptEventsOf(events)

    expect(mapped.find((event) => event.type === 'tool-called')).toMatchObject({
      input: { command: 'ls' },
    })
    expect(mapped.find((event) => event.type === 'tool-result')).toMatchObject({
      output: { stdout: 'a' },
    })
  })
})
