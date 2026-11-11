import {
  renderSkillListing,
  SKILL_LISTING_BUDGET_CHARS,
  type SkillListingEntry,
} from '@dltech/atlas-core'

import { SkillRegistryPort } from '../../skills/port'
import { VolatilePromptFragment } from '../volatile'

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

  override stamp(): string {
    return this.text()
  }

  text(): string {
    return renderSkillListing({
      entries: this.entries(),
      budgetChars: SKILL_LISTING_BUDGET_CHARS,
    }).trim()
  }
}
