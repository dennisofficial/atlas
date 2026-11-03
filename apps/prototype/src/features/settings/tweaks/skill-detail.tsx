'use client'

import { useEffect } from 'react'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import { ESkillOwner } from '../fixtures/settings-skills'
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

export function SkillDetailTweaked({ skillName }: { skillName: string }) {
  const { state } = usePrototype(CONTROLS)
  useEffect(() => resetSkills(), [])
  return (
    <SkillDetailPage
      key={state}
      owner={ESkillOwner.Global}
      skillName={skillName}
      listHref="/settings/skills"
      {...optionOf({ table: STATES, key: state, fallback: {} })}
    />
  )
}
