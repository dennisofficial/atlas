'use client'

import { useEffect } from 'react'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import { SKILLS } from '../fixtures/settings-skills'
import { SkillDetailPage } from '../skill-detail'
import { resetSkills } from '../use-skills'

type DetailProps = { forceConflict?: boolean }

const STATES: Record<string, DetailProps> = {
  default: {},
  conflict: { forceConflict: true },
}

const CONTROLS = {
  state: { type: 'select', label: 'State', options: Object.keys(STATES), default: 'default' },
} satisfies Record<string, Control>

export function SkillDetailTweaked({ skillId }: { skillId: string }) {
  const { state } = usePrototype(CONTROLS)
  useEffect(() => resetSkills(SKILLS), [])
  return (
    <SkillDetailPage
      key={state}
      skillId={skillId}
      {...optionOf({ table: STATES, key: state, fallback: {} })}
    />
  )
}
