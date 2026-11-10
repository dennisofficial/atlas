import { renderSkillListing, type SkillListingEntry } from '../core'
import type { SkillCatalogue } from './catalogue'

export const SKILL_LISTING_HEADING = 'Skills available to load:'

const CHARS_PER_TOKEN = 4
const CONTEXT_FRACTION = 0.03

export const listingBudgetChars = (contextWindowTokens: number): number =>
  Math.floor(contextWindowTokens * CHARS_PER_TOKEN * CONTEXT_FRACTION)

const entriesOf = (catalogue: SkillCatalogue): readonly SkillListingEntry[] =>
  catalogue.skills
    .filter((skill) => skill.modelInvocable)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
    }))

export const skillListingOf = (args: {
  catalogue: SkillCatalogue
  budgetChars: number
}): string => {
  const rendered = renderSkillListing({
    entries: entriesOf(args.catalogue),
    budgetChars: args.budgetChars,
  }).trim()
  return rendered === '' ? '' : `${SKILL_LISTING_HEADING}\n${rendered}`
}
