import { describe, expect, it } from 'bun:test'

import {
  renderSkillListing,
  SKILL_LISTING_MAX_DESCRIPTION_CHARS,
  SKILL_LISTING_MIN_DESCRIPTION_CHARS,
} from '../listing'

const entry = (name: string, description: string, whenToUse?: string) => ({
  name,
  description,
  whenToUse,
})

describe('renderSkillListing', () => {
  it('renders nothing for no entries', () => {
    expect(renderSkillListing({ entries: [] })).toBe('')
  })

  it('renders one line per skill with the description then Use when', () => {
    expect(
      renderSkillListing({
        entries: [entry('alpha', 'does alpha', 'alpha is asked'), entry('beta', 'does beta')],
      }),
    ).toBe('- alpha: does alpha Use when: alpha is asked\n- beta: does beta')
  })

  it('caps one description at 1536 characters', () => {
    const rendered = renderSkillListing({ entries: [entry('alpha', 'x'.repeat(4000))] })
    const summary = rendered.replace('- alpha: ', '')
    expect(summary.length).toBe(SKILL_LISTING_MAX_DESCRIPTION_CHARS)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('shrinks descriptions to fit the budget without dropping a name', () => {
    const entries = Array.from({ length: 5 }, (_, at) => entry(`s${at}`, 'y'.repeat(400)))
    const full = renderSkillListing({ entries })
    const rendered = renderSkillListing({ entries, budgetChars: Math.floor(full.length / 2) })
    expect(rendered.length).toBeLessThanOrEqual(Math.floor(full.length / 2))
    for (const one of entries) expect(rendered).toContain(`- ${one.name}`)
    expect(rendered).toContain('…')
  })

  it('drops descriptions, then every name, when even the floor does not fit', () => {
    const entries = [entry('alpha', 'z'.repeat(400)), entry('beta', 'z'.repeat(400))]
    const descriptionsGone = renderSkillListing({ entries, budgetChars: 40 })
    expect(descriptionsGone).toBe('- alpha\n- beta')

    const tight = entries.map((one) => ({ ...one, name: `${one.name}${'n'.repeat(40)}` }))
    expect(renderSkillListing({ entries: tight, budgetChars: 10 })).toContain('- ')
    expect(renderSkillListing({ entries: tight, budgetChars: 10 }).length).toBeGreaterThanOrEqual(
      tight.length * 3,
    )
  })

  it('keeps the floor long enough to still be a description', () => {
    const entries = [entry('alpha', 'q'.repeat(600))]
    const rendered = renderSkillListing({
      entries,
      budgetChars: SKILL_LISTING_MIN_DESCRIPTION_CHARS + 20,
    })
    expect(rendered.startsWith('- alpha: q')).toBe(true)
  })
})
