'use client'

import { useEffect } from 'react'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { SKILLS } from '../fixtures/settings-skills'
import { SkillsPage } from '../skills-page'
import { resetSkills } from '../use-skills'

const CONTROLS = {
  state: { type: 'select', label: 'State', options: ['default'], default: 'default' },
} satisfies Record<string, Control>

export function SkillsTweaked() {
  usePrototype(CONTROLS)
  useEffect(() => resetSkills(SKILLS), [])
  return <SkillsPage />
}
