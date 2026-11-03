'use client'

import { useEffect } from 'react'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { ESkillOwner } from '../fixtures/settings-skills'
import { SkillsPage } from '../skills-page'
import { resetSkills } from '../use-skills'

const CONTROLS = {
  state: { type: 'select', label: 'State', options: ['default'], default: 'default' },
} satisfies Record<string, Control>

export function SkillsTweaked() {
  usePrototype(CONTROLS)
  useEffect(() => resetSkills(), [])
  return (
    <SkillsPage
      owner={ESkillOwner.Global}
      title="Skills"
      description="Your personal skills, loaded in every thread on every project."
      detailHref={(name) => `/settings/skills/${name}`}
    />
  )
}
