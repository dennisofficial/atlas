import { renderSkillListing, type PromptContext, type SkillListingEntry } from '@dltech/atlas-core'

import { SkillRegistryPort } from '../../skills/port'
import { VolatilePromptFragment } from '../volatile'

const SKILL_LISTING_BUDGET_FRACTION_OF_CONTEXT = 0.03
const CHARS_PER_TOKEN = 4

const budgetCharsFor = (ctx: PromptContext): number =>
  Math.floor(ctx.model.contextWindow * CHARS_PER_TOKEN * SKILL_LISTING_BUDGET_FRACTION_OF_CONTEXT)

export class SkillListingFragment extends VolatilePromptFragment {
  readonly id = 'skills.listing'

  constructor(private readonly skills: SkillRegistryPort) {
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
    return renderSkillListing({ entries: this.entries(), budgetChars: budgetCharsFor(ctx) }).trim()
  }
}
