import { describe, expect, it } from 'bun:test'

import { EContextSlot } from '../../context/slot'
import type { Assembled, AssembledMessage } from '../assembled'
import { messagesFromEvents } from '../rules/messages-from-events'
import { rotatedHandoff } from '../rules/rotated-handoff'
import { contextFor, log, operatorSaidAs } from './log-fixture'

const EMPTY: Assembled = { system: [], messages: [] }

type Entry = { events: ReturnType<typeof log> }

const messageTextOf = (entry: AssembledMessage): string => {
  const content = entry.message.content
  const parts = Array.isArray(content) ? content : [content]
  return parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
}

const assembledWith = ({ events }: Entry): Assembled => {
  const ctx = contextFor({ events })
  return rotatedHandoff()(messagesFromEvents()(EMPTY, ctx), ctx)
}

const textOf = (assembled: Assembled): string => assembled.messages.map(messageTextOf).join('\n')

describe('rotatedHandoff', () => {
  it('leaves the request alone when the thread never rotated', () => {
    const events = log([{ type: 'user-said', text: 'hello' }])
    const before = messagesFromEvents()(EMPTY, contextFor({ events }))

    expect(rotatedHandoff()(before, contextFor({ events }))).toBe(before)
  })

  it('opens the request with the brief and keeps what landed after the boundary', () => {
    const events = log([
      { type: 'user-said', text: 'before the boundary' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'also before' }] },
      { type: 'rotated', handoff: 'the plan, the files and the branch' },
      { type: 'user-said', text: 'carry on' },
    ])
    const assembled = assembledWith({ events })
    const boundary = events[2]?.seq ?? 0
    const text = textOf(assembled)

    expect(assembled.messages[0]?.message.role).toBe('user')
    expect(text).toContain('the plan, the files and the branch')
    expect(text).not.toContain('before the boundary')
    expect(text).not.toContain('also before')
    expect(text).toContain('carry on')
    expect(assembled.messages.slice(1).every((entry) => entry.origin.seq >= boundary)).toBe(true)
  })

  it('prepends exactly one brief when the thread rotated twice', () => {
    const events = log([
      { type: 'rotated', handoff: 'first brief' },
      { type: 'user-said', text: 'one' },
      { type: 'rotated', handoff: 'second brief' },
      { type: 'user-said', text: 'two' },
    ])
    const assembled = assembledWith({ events })
    const text = textOf(assembled)

    expect(text).toContain('second brief')
    expect(text).not.toContain('first brief')
    expect(
      assembled.messages.filter((entry) => messageTextOf(entry).includes('second brief')),
    ).toHaveLength(1)
  })
  it('keeps the context that is still current across the boundary, right after the brief', () => {
    const events = log([
      { type: 'user-said', text: 'before the boundary' },
      {
        type: 'context-loaded',
        slot: EContextSlot.McpInstructions,
        key: 'paper',
        content: 'Paper is a design tool.',
      },
      { type: 'rotated', handoff: 'the plan, the files and the branch' },
      { type: 'user-said', text: 'carry on' },
    ])
    const texts = assembledWith({ events }).messages.map(messageTextOf)

    expect(texts[0]).toContain('the plan, the files and the branch')
    expect(texts[1]).toContain('Paper is a design tool.')
    expect(texts[2]).toEqual(operatorSaidAs('carry on'))
    expect(texts.slice(1).every((text) => !text.includes('before the boundary'))).toBe(true)
  })

  it('carries the current context in the order the log recorded it', () => {
    const events = log([
      {
        type: 'context-loaded',
        slot: EContextSlot.UserInstructions,
        key: 'AGENTS.md',
        content: 'first',
      },
      { type: 'context-loaded', slot: EContextSlot.SkillListing, key: 'skills', content: 'second' },
      { type: 'rotated', handoff: 'the brief' },
      { type: 'user-said', text: 'carry on' },
    ])
    const texts = assembledWith({ events }).messages.map(messageTextOf)

    expect(texts[1]).toContain('first')
    expect(texts[2]).toContain('second')
    expect(texts[3]).toEqual(operatorSaidAs('carry on'))
  })

  it('does not bring back context the log has since replaced', () => {
    const events = log([
      {
        type: 'context-loaded',
        slot: EContextSlot.ProjectInstructions,
        key: 'AGENTS.md',
        content: 'the replaced instructions',
      },
      { type: 'rotated', handoff: 'the brief' },
      {
        type: 'context-loaded',
        slot: EContextSlot.ProjectInstructions,
        key: 'AGENTS.md',
        content: 'the current instructions',
      },
    ])
    const texts = assembledWith({ events }).messages.map(messageTextOf)

    expect(texts.join('\n')).toContain('the current instructions')
    expect(texts.join('\n')).not.toContain('the replaced instructions')
  })
})
