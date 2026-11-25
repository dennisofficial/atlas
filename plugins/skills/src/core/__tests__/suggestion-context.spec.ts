import { describe, expect, it } from 'bun:test'

import { EMessageOrigin, type RecordEvent } from '@dltech/atlas-core'

import {
  SKILL_SUGGEST_AGENT_CHARS,
  SKILL_SUGGEST_OPERATOR_CHARS,
  skillSuggestionStateOf,
} from '../suggestion-context'

let seq = 0

const stamped = (body: Record<string, unknown>): RecordEvent =>
  ({
    id: `e${++seq}`,
    seq,
    threadId: 't',
    runId: 'r',
    depth: 0,
    at: '',
    epoch: 0,
    prevHash: '',
    ...body,
  }) as RecordEvent

const operator = (text: string): RecordEvent => stamped({ type: 'user-said', text })

const peer = (text: string): RecordEvent =>
  stamped({ type: 'user-said', text, via: EMessageOrigin.PeerAgent })

const reply = (text: string): RecordEvent =>
  stamped({ type: 'assistant-said', parts: [{ type: 'text', text }] })

const skillCall = (input: unknown): RecordEvent =>
  stamped({ type: 'tool-called', callId: 'c', name: 'skill', input, ordinal: 0 })

const suggestion = (): RecordEvent =>
  stamped({
    type: 'context-loaded',
    slot: 'skill-suggestion',
    key: 'latest',
    content: 'skill: video — 0.90',
  })

const posted = (inboxId: number, text: string, via?: EMessageOrigin): RecordEvent =>
  stamped({
    type: 'input-posted',
    inboxId,
    kind: 'message',
    postedAt: '',
    message: { text, ...(via === undefined ? {} : { via }) },
  })

const drained = (inboxId: number, text: string): RecordEvent =>
  stamped({ type: 'user-said', text, inboxId })

const suggestionFor = (inboxId: number): RecordEvent =>
  stamped({
    type: 'context-loaded',
    slot: 'skill-suggestion',
    key: 'latest',
    content: 'skill: video — 0.90',
    triggeredBy: `inbox:${inboxId}`,
  })

describe('skillSuggestionStateOf', () => {
  it('reads an operator message still waiting in the inbox before the turn drains it', () => {
    const state = skillSuggestionStateOf({ events: [posted(1, 'make a demo clip')] })
    expect(state?.turns).toEqual([{ operator: 'make a demo clip', agent: undefined }])
    expect(state?.trigger).toBe('inbox:1')
  })

  it('pairs a waiting message with the earlier turns and their replies', () => {
    const state = skillSuggestionStateOf({
      events: [posted(1, 'one'), drained(1, 'one'), reply('one reply'), posted(2, 'two')],
    })
    expect(state?.turns).toEqual([
      { operator: 'one', agent: 'one reply' },
      { operator: 'two', agent: undefined },
    ])
  })

  it('ignores a waiting peer message', () => {
    expect(
      skillSuggestionStateOf({ events: [posted(1, 'ping', EMessageOrigin.PeerAgent)] }),
    ).toBeUndefined()
  })

  it('stays quiet for a message whose suggestion came before it was drained', () => {
    expect(
      skillSuggestionStateOf({ events: [posted(1, 'clip'), suggestionFor(1), drained(1, 'clip')] }),
    ).toBeUndefined()
    expect(
      skillSuggestionStateOf({ events: [posted(1, 'clip'), suggestionFor(1)] }),
    ).toBeUndefined()
  })

  it('is quiet with no operator message', () => {
    expect(skillSuggestionStateOf({ events: [] })).toBeUndefined()
    expect(skillSuggestionStateOf({ events: [peer('do a thing')] })).toBeUndefined()
  })

  it('is quiet once the latest message is answered', () => {
    expect(
      skillSuggestionStateOf({ events: [operator('make a clip'), reply('done')] }),
    ).toBeUndefined()
  })

  it('is quiet once the latest message has a suggestion', () => {
    expect(
      skillSuggestionStateOf({ events: [operator('make a clip'), suggestion()] }),
    ).toBeUndefined()
  })

  it('reads again for a new message after an earlier suggestion', () => {
    const state = skillSuggestionStateOf({
      events: [operator('make a clip'), suggestion(), reply('ok'), operator('keep it vertical')],
    })
    expect(state?.turns.map((turn) => turn.operator)).toEqual(['make a clip', 'keep it vertical'])
  })

  it('pairs three turns with their last replies, oldest first, and drops a fourth', () => {
    const state = skillSuggestionStateOf({
      events: [
        operator('one'),
        reply('one reply'),
        operator('two'),
        reply('two early'),
        reply('two late'),
        operator('three'),
        reply('three reply'),
        operator('four'),
      ],
    })
    expect(state?.turns).toEqual([
      { operator: 'two', agent: 'two late' },
      { operator: 'three', agent: 'three reply' },
      { operator: 'four', agent: undefined },
    ])
  })

  it('ignores a peer message as a turn boundary', () => {
    const state = skillSuggestionStateOf({ events: [operator('one'), peer('ping')] })
    expect(state?.turns).toEqual([{ operator: 'one', agent: undefined }])
  })

  it('applies the character caps', () => {
    const state = skillSuggestionStateOf({
      events: [operator('o'.repeat(5_000)), reply('a'.repeat(5_000)), operator('next')],
    })
    expect(state?.turns[0]?.operator.length).toBe(SKILL_SUGGEST_OPERATOR_CHARS)
    expect(state?.turns[0]?.agent?.length).toBe(SKILL_SUGGEST_AGENT_CHARS)
  })

  it('lists loaded skills lowercased and unique, and ignores a non-string name', () => {
    const state = skillSuggestionStateOf({
      events: [
        skillCall({ name: 'Video' }),
        skillCall({ name: 'video' }),
        skillCall({ name: 7 }),
        skillCall(null),
        stamped({ type: 'context-loaded', slot: 'skill', key: 'commit', content: 'body' }),
        operator('next'),
      ],
    })
    expect(state?.loaded).toEqual(['video', 'commit'])
  })

  it('forgets a rewound suggestion', () => {
    const asked = operator('make a clip')
    const suggested = suggestion()
    const rewound = stamped({ type: 'history-rewound', toSeq: asked.seq - 1 })
    const state = skillSuggestionStateOf({ events: [asked, suggested, rewound, operator('again')] })
    expect(state?.turns).toEqual([{ operator: 'again', agent: undefined }])
  })
})
