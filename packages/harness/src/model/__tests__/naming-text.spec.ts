import {
  EContextSlot,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type SaidImage,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { NAMING_ATTACHMENT_CHARACTER_LIMIT, namingImagesOf, namingTextOf } from '../naming-text'

const fileDraft = (path: string, content: string): EventDraft => ({
  type: 'context-loaded',
  slot: EContextSlot.File,
  key: path,
  content,
})

const skillDraft = (name: string, body: string): EventDraft => ({
  type: 'context-loaded',
  slot: EContextSlot.Skill,
  key: name,
  content: body,
})

const RUN = toRunId('run_opening')
const THREAD = toThreadId('brn_test')

const eventOf = (seq: number, body: EventDraft): Event =>
  ({
    ...body,
    id: `evt_${seq}`,
    seq,
    threadId: THREAD,
    runId: RUN,
    depth: 0,
    at: '2026-09-28T00:00:00.000Z',
  }) as Event

const saidEvent = (seq: number, text: string, images?: readonly SaidImage[]): Event =>
  eventOf(seq, { type: 'user-said', text, ...(images === undefined ? {} : { images }) })

const contextEvent = (seq: number, slot: EContextSlot, key: string, content: string): Event =>
  eventOf(seq, { type: 'context-loaded', slot, key, content })

const SCREENSHOT: SaidImage = {
  path: '/tmp/rewind-blank-pane.png',
  mediaType: 'image/png',
  data: 'aGVsbG8=',
  width: 800,
  height: 600,
}

describe('namingTextOf', () => {
  it('is the opening message alone when nothing was attached to it', () => {
    expect(namingTextOf({ said: 'the refresh token never rotates' })).toBe(
      'the refresh token never rotates',
    )
  })

  it('hands the titler the head of a file the opening message attached', () => {
    const text = namingTextOf({
      said: 'check out this handoff, and lets plan it',
      context: [
        fileDraft(
          '/tmp/atlas-rewind-subagents-handoff.md',
          '# Handoff: rewind kills sub-agents\n\nWhen a turn is rewound, its sub-agents...',
        ),
      ],
    })

    expect(text).toContain('check out this handoff, and lets plan it')
    expect(text).toContain('/tmp/atlas-rewind-subagents-handoff.md')
    expect(text).toContain('Handoff: rewind kills sub-agents')
  })

  it('excerpts an attached file rather than sending it to be named whole', () => {
    const text = namingTextOf({
      said: 'plan this',
      context: [fileDraft('/tmp/big-handoff.md', 'h'.repeat(9000))],
    })

    expect(text.length).toBeLessThan('plan this'.length + NAMING_ATTACHMENT_CHARACTER_LIMIT + 60)
  })

  it('leaves an invoked skill out, since the message already names it', () => {
    const text = namingTextOf({
      said: 'lets /implement with /tdd',
      context: [skillDraft('tdd', 'write the failing test first, watch it fail, then...')],
    })

    expect(text).toBe('lets /implement with /tdd')
  })

  it('ignores drafts that carry no context', () => {
    const text = namingTextOf({
      said: 'hello',
      context: [{ type: 'user-said', text: 'noise' }],
    })

    expect(text).toBe('hello')
  })
})

describe('namingImagesOf', () => {
  it('hands the titler the pictures pasted into the opening message', () => {
    const events = [saidEvent(1, 'look at this screenshot', [SCREENSHOT])]

    expect(namingImagesOf(events)).toEqual([SCREENSHOT])
  })

  it('drops a picture too heavy to inline, already named by its path line in the text', () => {
    const tooWide: SaidImage = { ...SCREENSHOT, width: 9000, height: 80 }
    const events = [saidEvent(1, 'what is this', [tooWide])]

    expect(namingImagesOf(events)).toEqual([])
  })

  it('is empty when the opening message carried no pictures', () => {
    const events = [saidEvent(1, 'just prose')]

    expect(namingImagesOf(events)).toEqual([])
  })

  it('reads the pictures off the first turn alone, not a later one', () => {
    const events = [
      saidEvent(1, 'opening, no pictures'),
      eventOf(2, { type: 'assistant-said', parts: [{ type: 'text', text: 'reply' }] }),
      eventOf(3, { type: 'user-said', text: 'follow-up with a picture', images: [SCREENSHOT] }),
    ]

    expect(namingImagesOf(events)).toEqual([])
  })
})
