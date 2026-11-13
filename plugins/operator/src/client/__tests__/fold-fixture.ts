import type { V2Event } from '@dltech/atlas-core'

export const stamp = (n: number, body: Record<string, unknown>): V2Event =>
  ({
    ...body,
    seq: n,
    at: `2026-11-12T11:5${n}:00.000Z`,
    threadId: 't1',
    id: `e${n}`,
  }) as unknown as V2Event

export const parkedOf = (n: number, extra: Record<string, unknown> = {}): V2Event =>
  stamp(n, {
    type: 'tool-parked',
    callId: 'call_1',
    name: 'operator_input',
    request: { kind: 'input', prompt: 'What is the login code?' },
    ...extra,
  })

export const resultOf = (n: number, extra: Record<string, unknown> = {}): V2Event =>
  stamp(n, { type: 'tool-result', callId: 'call_1', name: 'operator_input', ...extra })
