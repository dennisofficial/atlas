import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toCallId, toEventId, toRunId, toThreadId } from '../ids'
import { loopCutPlan } from '../loop-cut'
import { stampDrafts } from '../stamp'

const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

const user = (text: string): EventDraft => ({ type: 'user-said', text })

const round = (args: { id: string; modelText?: string | undefined }): EventDraft[] => [
  { type: 'assistant-said', parts: [{ type: 'text', text: 'checking' }] },
  {
    type: 'tool-called',
    callId: toCallId(args.id),
    name: 'bash',
    input: { command: 'git status' },
    ordinal: 0,
  },
  {
    type: 'tool-result',
    callId: toCallId(args.id),
    name: 'bash',
    output: { exitCode: 0 },
    modelText: args.modelText ?? 'clean',
  },
]

const rounds = (args: {
  prefix: string
  count: number
  modelText?: string | undefined
}): EventDraft[] =>
  Array.from({ length: args.count }, (_, index) =>
    round({ id: `${args.prefix}-${index}`, modelText: args.modelText }),
  ).flat()

const everything = (): boolean => true
const nothing = (): boolean => false

const fixtures: Record<string, EventDraft[]> = {
  'a run after one prompt': [user('go'), ...rounds({ prefix: 'a', count: 4 })],
  'a run after the second prompt': [
    user('first'),
    ...rounds({ prefix: 'a', count: 5, modelText: 'old' }),
    user('second'),
    ...rounds({ prefix: 'b', count: 3 }),
  ],
  'a run before the last prompt only': [
    user('first'),
    ...rounds({ prefix: 'a', count: 5 }),
    user('second'),
    ...rounds({ prefix: 'b', count: 1 }),
  ],
  'a run with no prompt at all': rounds({ prefix: 'a', count: 3 }),
  'a prompt as the last event': [...rounds({ prefix: 'a', count: 4 }), user('stop')],
  'a short run': [user('go'), ...rounds({ prefix: 'a', count: 2 })],
  'a run interrupted by a nudge': [
    user('go'),
    ...rounds({ prefix: 'a', count: 3 }),
    { type: 'nudge', text: 'keep going', lifetimeSteps: 1 },
    ...rounds({ prefix: 'b', count: 2 }),
  ],
}

describe('loopCutPlan on the tail after the last user message', () => {
  for (const [name, drafts] of Object.entries(fixtures)) {
    for (const [label, repeatable] of [
      ['repeatable', everything],
      ['not repeatable', nothing],
    ] as const) {
      it(`gives the whole-log plan for ${name} (${label})`, () => {
        const events = eventsFrom(drafts)
        const spoken = events.findLast((event) => event.type === 'user-said')?.seq ?? 0
        const tail = events.filter((event) => event.seq > spoken)

        expect(loopCutPlan({ events: tail, repeatable })).toEqual(
          loopCutPlan({ events, repeatable }),
        )
      })
    }
  }
})
