import { describe, expect, it } from 'bun:test'

import { log } from '../../assembly/__tests__/log-fixture'
import { EContextSlot } from '../../context/slot'
import { EMessageOrigin } from '../body'
import { unansweredTail, unexpandedSkillDrafts } from '../unanswered-tail'

const skill = {
  type: 'context-loaded',
  slot: EContextSlot.Skill,
  key: 'review',
  content: 'x',
} as const

describe('unansweredTail', () => {
  it('keeps only operator messages after the last assistant turn', () => {
    const events = log([
      { type: 'user-said', text: 'old' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'hi' }] },
      { type: 'user-said', text: 'new' },
      { type: 'user-said', text: 'agent', via: EMessageOrigin.ParentAgent },
      skill,
    ])
    const tail = unansweredTail(events)
    expect(tail.operatorMessages.map((e) => e.text)).toEqual(['new'])
    expect(tail.loadedSkills).toHaveLength(1)
  })

  it('expands each message against skills already loaded in the tail', () => {
    const events = log([{ type: 'user-said', text: '/review' }, skill])
    const seen: number[] = []
    const added = unexpandedSkillDrafts({
      events,
      expand: ({ context }) => {
        seen.push(context.length)
        return context.length === 0 ? [skill] : []
      },
    })
    expect(seen).toEqual([1])
    expect(added).toEqual([])
  })
})
