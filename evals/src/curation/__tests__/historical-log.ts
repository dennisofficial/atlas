import { eventBodySchema, eventEnvelopeSchema, type EventEnvelope } from '@dltech/atlas-core'

import { renderUnifiedDiff } from '@dltech/atlas-plugin-quality/review'

const EVENT_LINE_VERSION = 1

const encodeEventLine = ({
  draft,
  envelope,
}: {
  draft: { type: string }
  envelope: EventEnvelope
}): string =>
  JSON.stringify({
    v: EVENT_LINE_VERSION,
    id: envelope.id,
    seq: envelope.seq,
    threadId: envelope.threadId,
    runId: envelope.runId,
    ...(envelope.parentRunId === undefined ? {} : { parentRunId: envelope.parentRunId }),
    depth: envelope.depth,
    at: envelope.at,
    type: draft.type,
    body: draft,
  })

type Body = Record<string, unknown>

export const makeLog = ({
  threadId = 'th_1',
  runId = 'run_1',
}: {
  threadId?: string
  runId?: string
} = {}) => {
  const events: unknown[] = []
  const add = (body: Body, extra: Body = {}): void => {
    const seq = events.length + 1
    const second = String(seq).padStart(2, '0')
    events.push({
      id: `ev_${seq}`,
      seq,
      threadId,
      runId,
      depth: 0,
      at: `2026-10-01T00:00:${second}Z`,
      ...body,
      ...extra,
    })
  }
  const call = ({
    callId,
    name,
    input,
    extra,
  }: {
    callId: string
    name: string
    input: unknown
    extra?: Body
  }): void => add({ type: 'tool-called', callId, name, input, ordinal: 0 }, extra)
  const result = ({
    callId,
    name,
    output,
    extra,
    tail,
  }: {
    callId: string
    name: string
    output?: unknown
    extra?: Body
    tail?: Body
  }): void => add({ type: 'tool-result', callId, name, output, ...tail }, extra)
  const write = ({
    callId,
    path,
    content,
    created,
    bytes,
  }: {
    callId: string
    path: string
    content: string
    created: boolean
    bytes?: number
  }): void => {
    call({ callId, name: 'write', input: { path, content } })
    result({
      callId,
      name: 'write',
      output: { path, created, bytes: bytes ?? Buffer.byteLength(content, 'utf8') },
    })
  }
  const edit = ({
    callId,
    path,
    before,
    after,
    name = 'edit',
  }: {
    callId: string
    path: string
    before: string
    after: string
    name?: string
  }): void => {
    const input =
      name === 'edit'
        ? { path, oldString: 'x', newString: 'y' }
        : { path, edits: [{ oldString: 'x', newString: 'y' }] }
    call({ callId, name, input })
    result({
      callId,
      name,
      output: { path, diff: renderUnifiedDiff({ path, oldContent: before, newContent: after }) },
    })
  }
  return { events, add, call, result, write, edit }
}

const ENVELOPE_KEYS = ['id', 'seq', 'threadId', 'runId', 'parentRunId', 'depth', 'at']

export const toDiskLines = ({ events }: { events: readonly unknown[] }): string[] =>
  events.map((event) => {
    if (typeof event !== 'object' || event === null) return JSON.stringify(event)
    const record: Record<string, unknown> = { ...event }
    const envelope = eventEnvelopeSchema.parse(record)
    const draft = Object.fromEntries(
      Object.entries(record).filter(([key]) => !ENVELOPE_KEYS.includes(key)),
    )
    return encodeEventLine({ draft: eventBodySchema.parse(draft), envelope })
  })
