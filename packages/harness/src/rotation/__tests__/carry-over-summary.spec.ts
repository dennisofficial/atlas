import { describe, expect, it } from 'bun:test'

import { carryOverSystemPrompt } from '../carry-over-summary'

const SECTIONS = [
  'Current task',
  'Locked decisions',
  'Live work',
  'Progress on disk',
  'Codebase knowledge',
  'Failures and dead ends',
  'Next action',
]

describe('carryOverSystemPrompt', () => {
  it('frames the summary as the whole of what the agent wakes with', () => {
    const prompt = carryOverSystemPrompt({ instructions: '' })

    expect(prompt).toContain('ONLY')
    expect(prompt).toContain('hidden from')
    expect(prompt).toContain('second person')
  })

  it('names every carry-over section, in order', () => {
    const prompt = carryOverSystemPrompt({ instructions: '' })
    const positions = SECTIONS.map((section) => prompt.indexOf(`${section} — `))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('adds no operator line when the instructions are blank', () => {
    expect(carryOverSystemPrompt({ instructions: '  \n' })).not.toContain("operator's instructions")
  })

  it('folds operator instructions into Next action', () => {
    const prompt = carryOverSystemPrompt({ instructions: ' run the tests first ' })

    expect(prompt).toContain("The operator's instructions for after the rotation: run the tests first")
    expect(prompt).toContain('Fold these into Next action')
  })
})
