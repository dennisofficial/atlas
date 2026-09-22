import { describe, expect, it } from 'bun:test'

import type { DecisionAnswer } from '../../ports/decision.port'
import {
  SKILL_SUGGEST_EXCERPT_CHARS,
  SKILL_SUGGEST_FITS_THRESHOLD,
  SKILL_SUGGEST_GATE_THRESHOLD,
  SKILL_SUGGEST_MAX_CANDIDATES,
  SKILL_SUGGEST_WHICH_KEY,
  skillGateScore,
  skillRerankQuestions,
  skillRerankWinner,
  skillShortlist,
  skillSuggestionBlock,
  skillWideQuestions,
  type SkillSuggestionCandidate,
} from '../suggestion'

const candidate = (name: string, extra?: Partial<SkillSuggestionCandidate>): SkillSuggestionCandidate => ({
  name,
  description: `${name} description`,
  whenToUse: undefined,
  ...extra,
})

const gateAnswers = (acts: number, procedure: number, prose: number): Record<string, DecisionAnswer> => ({
  'gate::acts_on_user_system': { noul: acts },
  'gate::would_follow_documented_procedure': { noul: procedure },
  'gate::prose_suffices': { noul: prose },
})

describe('skillWideQuestions', () => {
  it('asks one choice over every candidate plus the three gate nouls', () => {
    const questions = skillWideQuestions({ candidates: [candidate('alpha'), candidate('beta')] })
    expect(Object.keys(questions).sort()).toEqual([
      'gate::acts_on_user_system',
      'gate::prose_suffices',
      'gate::would_follow_documented_procedure',
      'which',
    ])

    const which = questions[SKILL_SUGGEST_WHICH_KEY]
    expect(which?.type).toBe('choice')
    if (which?.type !== 'choice') return
    expect(Object.keys(which.criteria)).toEqual(['alpha', 'beta'])
    expect(which.criteria['alpha']).toBe('alpha description')
  })

  it('folds whenToUse into the criteria the way the listing does', () => {
    const questions = skillWideQuestions({
      candidates: [candidate('alpha', { whenToUse: 'editing slides' })],
    })
    const which = questions[SKILL_SUGGEST_WHICH_KEY]
    if (which?.type !== 'choice') throw new Error('expected a choice question')
    expect(which.criteria['alpha']).toBe('alpha description Use when: editing slides')
  })

  it('caps the roster at the choice option ceiling', () => {
    const many = Array.from({ length: SKILL_SUGGEST_MAX_CANDIDATES + 20 }, (_, at) =>
      candidate(`skill-${at}`),
    )
    const questions = skillWideQuestions({ candidates: many })
    const which = questions[SKILL_SUGGEST_WHICH_KEY]
    if (which?.type !== 'choice') throw new Error('expected a choice question')
    expect(Object.keys(which.criteria)).toHaveLength(SKILL_SUGGEST_MAX_CANDIDATES)
  })
})

describe('skillGateScore', () => {
  it('means the three nouls with prose_suffices inverted', () => {
    expect(skillGateScore({ answers: gateAnswers(0.9, 0.6, 0.3) })).toBeCloseTo((0.9 + 0.6 + 0.7) / 3)
  })

  it('is undefined when a gate answer is missing', () => {
    const answers = gateAnswers(0.9, 0.6, 0.3)
    delete answers['gate::prose_suffices']
    expect(skillGateScore({ answers })).toBeUndefined()
  })
})

describe('skillShortlist', () => {
  it('ranks by probability, highest first, capped at the limit', () => {
    const answers: Record<string, DecisionAnswer> = {
      [SKILL_SUGGEST_WHICH_KEY]: {
        choice: 'beta',
        probabilities: { alpha: 0.1, beta: 0.6, gamma: 0.25, delta: 0.05 },
      },
    }
    expect(skillShortlist({ answers, limit: 3 })).toEqual(['beta', 'gamma', 'alpha'])
  })

  it('falls back to the bare choice when no distribution came back', () => {
    const answers: Record<string, DecisionAnswer> = {
      [SKILL_SUGGEST_WHICH_KEY]: { choice: 'beta' },
    }
    expect(skillShortlist({ answers })).toEqual(['beta'])
  })

  it('is empty when the choice answer is missing entirely', () => {
    expect(skillShortlist({ answers: {} })).toEqual([])
  })
})

describe('skillRerankQuestions', () => {
  it('carries the full summary and a body excerpt per candidate, plus one fits noul each', () => {
    const body = 'x'.repeat(SKILL_SUGGEST_EXCERPT_CHARS + 100)
    const questions = skillRerankQuestions({
      candidates: [candidate('alpha', { body }), candidate('beta')],
    })

    const which = questions[SKILL_SUGGEST_WHICH_KEY]
    if (which?.type !== 'choice') throw new Error('expected a choice question')
    expect(which.criteria['alpha']).toContain('alpha description')
    expect(which.criteria['alpha']).toContain('x'.repeat(SKILL_SUGGEST_EXCERPT_CHARS))
    expect(which.criteria['alpha']).not.toContain('x'.repeat(SKILL_SUGGEST_EXCERPT_CHARS + 1))
    expect(which.criteria['beta']).toBe('beta description')

    expect(questions['fits::alpha']?.type).toBe('noul')
    expect(questions['fits::alpha']?.instructions).toContain("'alpha'")
    expect(questions['fits::beta']?.type).toBe('noul')
  })
})

describe('skillRerankWinner', () => {
  const rerankAnswers = (choice: string, fits: Record<string, number>): Record<string, DecisionAnswer> => ({
    [SKILL_SUGGEST_WHICH_KEY]: { choice },
    ...Object.fromEntries(Object.entries(fits).map(([name, noul]) => [`fits::${name}`, { noul }])),
  })

  it('returns the choice when the best fits noul clears the threshold', () => {
    const answers = rerankAnswers('alpha', { alpha: 0.6, beta: 0.4 })
    expect(skillRerankWinner({ answers, candidates: ['alpha', 'beta'] })).toBe('alpha')
  })

  it('drops the whole shortlist when every fits noul lands under the threshold', () => {
    const answers = rerankAnswers('alpha', {
      alpha: SKILL_SUGGEST_FITS_THRESHOLD - 0.01,
      beta: 0.1,
    })
    expect(skillRerankWinner({ answers, candidates: ['alpha', 'beta'] })).toBeUndefined()
  })

  it('refuses a choice that names no shortlisted candidate', () => {
    const answers = rerankAnswers('gamma', { alpha: 0.9, beta: 0.8 })
    expect(skillRerankWinner({ answers, candidates: ['alpha', 'beta'] })).toBeUndefined()
  })

  it('treats a missing fits answer as zero', () => {
    const answers = rerankAnswers('alpha', { beta: 0.9 })
    expect(skillRerankWinner({ answers, candidates: ['alpha', 'beta'] })).toBe('alpha')
    const low = rerankAnswers('alpha', { beta: 0.1 })
    expect(skillRerankWinner({ answers: low, candidates: ['alpha', 'beta'] })).toBeUndefined()
  })
})

describe('skillSuggestionBlock', () => {
  it('names the winner as a hint the agent may ignore', () => {
    expect(skillSuggestionBlock({ name: 'pptx-author' })).toBe(
      '<skill_relevance>\n' +
        'Relevant to the current request: pptx-author. Ignore this if it does not fit what the user actually asked for.\n' +
        '</skill_relevance>',
    )
  })

  it('says so when nothing fits, so the roster pressure is answered', () => {
    expect(skillSuggestionBlock({ name: undefined })).toBe(
      '<skill_relevance>\nNo skill in the roster appears relevant to this request.\n</skill_relevance>',
    )
  })
})

describe('thresholds', () => {
  it('keeps the gate and fits thresholds at the cookbook values', () => {
    expect(SKILL_SUGGEST_GATE_THRESHOLD).toBe(0.3)
    expect(SKILL_SUGGEST_FITS_THRESHOLD).toBe(0.3)
  })
})
