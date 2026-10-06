import { renderSkillListing, type PromptContext, type SkillListingEntry } from '@dltech/atlas-core'

import { SkillRegistryPort } from '../../skills/port'
import { VolatilePromptFragment } from '../volatile'

const SKILL_LISTING_BUDGET_FRACTION_OF_CONTEXT = 0.03
const CHARS_PER_TOKEN = 4

const preamble = 'Load the skill that matches your task before choosing an approach.'

const UI_DESIGN_SKILL_NAME = 'ui-design'

const uiDesignDirective =
  'For every task involving UI design, implementation, changes, or review—including web, mobile, and terminal interfaces—load ui-design before choosing an approach. Load it alongside any other relevant skills, independently of the skill-relevance hint.'

const budgetCharsFor = (ctx: PromptContext): number =>
  Math.floor(
    ctx.model.contextWindow * CHARS_PER_TOKEN * SKILL_LISTING_BUDGET_FRACTION_OF_CONTEXT,
  )

export class SkillListingFragment extends VolatilePromptFragment {
  readonly id = 'skills.listing'

  constructor( private readonly skills: SkillRegistryPort) {
    super()
  }

  private entries(): readonly SkillListingEntry[] {
    return this.skills
      .all()
      .filter((skill) => skill.modelInvocable)
      .map((skill) => ({
        name: skill.spec.name,
        description: skill.frontmatter.description,
        whenToUse: skill.frontmatter.whenToUse,
      }))
  }

  override stamp(ctx: PromptContext): string {
    return this.text(ctx)
  }

  text(ctx: PromptContext): string {
    const entries = this.entries()
    if (entries.length === 0) return ''

    const standing = entries.some((entry) => entry.name === UI_DESIGN_SKILL_NAME)
      ? [uiDesignDirective]
      : []
    const listing = renderSkillListing({ entries, budgetChars: budgetCharsFor(ctx) }).trim()
    if (listing === '' && standing.length === 0) return ''

    return [preamble, ...standing, ...(listing === '' ? [] : [listing])].join('\n\n')
  }
}
