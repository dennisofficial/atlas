import { describe, expect, it } from 'bun:test'

import type { SkillListingEntry } from '../listing'
import {
  SKILL_SUGGEST_SHORTLIST,
  skillSuggestionAskOf,
  skillSuggestionBlockOf,
  skillSuggestionOf,
} from '../suggestion'

const entry = (name: string, description: string): SkillListingEntry => ({
  name,
  description,
  whenToUse: undefined,
})

const VIDEO = entry('video', 'Create videos: demo clips and product walkthroughs.')
const COMMIT = entry('commit', 'Stage the current work and write a commit message.')
const UI = entry('ui-design', 'Layout, spacing and typography for interfaces.')

const input = {
  turns: [
    { operator: 'make a 30 second demo clip of this PR', agent: 'Which format?' },
    { operator: 'keep it vertical', agent: undefined },
  ],
  loaded: [],
}

describe('skillSuggestionAskOf', () => {
  it('asks one yes/no per shortlisted skill and nothing else', () => {
    const ask = skillSuggestionAskOf({ input, candidates: [UI, VIDEO, COMMIT] })
    expect(ask?.names).toEqual(['video'])
    expect(Object.keys(ask?.questions ?? {})).toEqual(['fits:video'])
    expect(Object.values(ask?.questions ?? {}).every((question) => question.type === 'noul')).toBe(
      true,
    )
  })

  it('writes the turns first, then the listing', () => {
    const ask = skillSuggestionAskOf({ input, candidates: [VIDEO] })
    expect(ask?.state).toBe(
      'Operator: make a 30 second demo clip of this PR\n\nAgent: Which format?\n\nOperator: keep it vertical\n\nSkills the agent can load:\n- video: Create videos: demo clips and product walkthroughs.',
    )
  })

  it('leaves out a loaded skill', () => {
    expect(
      skillSuggestionAskOf({ input: { ...input, loaded: ['video'] }, candidates: [VIDEO] }),
    ).toBeUndefined()
  })

  it('is undefined with no overlapping candidate', () => {
    expect(skillSuggestionAskOf({ input, candidates: [UI, COMMIT] })).toBeUndefined()
  })

  it('keeps the best twelve, ties in catalogue order', () => {
    const weak = Array.from({ length: 14 }, (_, at) => entry(`weak-${at}`, 'a clip'))
    const strong = entry('strong', 'demo clip vertical')
    const ask = skillSuggestionAskOf({ input, candidates: [...weak, strong] })
    expect(ask?.names).toHaveLength(SKILL_SUGGEST_SHORTLIST)
    expect(ask?.names[0]).toBe('strong')
    expect(ask?.names[1]).toBe('weak-0')
    expect(ask?.names).not.toContain('weak-11')
  })
})

const answers = (fits: Record<string, number>) =>
  Object.fromEntries(Object.entries(fits).map(([name, noul]) => [`fits:${name}`, { noul }]))

describe('skillSuggestionOf', () => {
  const names = ['video', 'commit']

  it('is quiet when the winner is below the fits threshold', () => {
    expect(
      skillSuggestionOf({ answers: answers({ video: 0.74, commit: 0.1 }), names }),
    ).toBeUndefined()
  })

  it('names a clear winner', () => {
    expect(skillSuggestionOf({ answers: answers({ video: 0.76, commit: 0.6 }), names })).toEqual({
      name: 'video',
      probability: 0.76,
    })
  })

  it('is quiet when the runner-up is within the margin', () => {
    expect(
      skillSuggestionOf({ answers: answers({ video: 0.8, commit: 0.7 }), names }),
    ).toBeUndefined()
  })

  it('is quiet on a missing answer', () => {
    expect(skillSuggestionOf({ answers: answers({ video: 0.95 }), names })).toBeUndefined()
  })

  it('is quiet on a probability outside [0, 1]', () => {
    expect(
      skillSuggestionOf({ answers: answers({ video: 1.2, commit: 0.1 }), names }),
    ).toBeUndefined()
    expect(
      skillSuggestionOf({ answers: answers({ video: 0.9, commit: -0.1 }), names }),
    ).toBeUndefined()
  })
})

describe('skillSuggestionBlockOf', () => {
  it('writes the name and the score to two decimals', () => {
    expect(skillSuggestionBlockOf({ name: 'video', probability: 0.8666 })).toBe(
      'skill: video — 0.87',
    )
  })
})
