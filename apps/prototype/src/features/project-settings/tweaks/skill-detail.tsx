'use client'

import { useEffect } from 'react'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import { ESkillOwner } from '../../settings/fixtures/settings-skills'
import { SkillDetailPage } from '../../settings/skill-detail'
import { resetSkills } from '../../settings/use-skills'
import { useProjectFixture } from '../project-fixture-context'

type DetailProps = { forceConflict?: boolean }

const STATES: Record<string, DetailProps> = {
  default: {},
  conflict: { forceConflict: true },
}

const CONTROLS = {
  state: { type: 'select', label: 'State', options: Object.keys(STATES), default: 'default' },
} satisfies Record<string, Control>

export function ProjectSkillDetailTweaked({ skillName }: { skillName: string }) {
  const { state } = usePrototype(CONTROLS)
  const project = useProjectFixture()
  useEffect(() => resetSkills(), [])
  const projectId = `${project.owner}/${project.name}`
  return (
    <SkillDetailPage
      key={state}
      owner={ESkillOwner.Project}
      skillName={skillName}
      listHref={`/projects/${encodeURIComponent(projectId)}/settings/skills`}
      {...optionOf({ table: STATES, key: state, fallback: {} })}
    />
  )
}
