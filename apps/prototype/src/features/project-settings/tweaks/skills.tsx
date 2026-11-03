'use client'

import { useEffect } from 'react'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { ESkillOwner } from '../../settings/fixtures/settings-skills'
import { SkillsPage } from '../../settings/skills-page'
import { resetSkills } from '../../settings/use-skills'
import { useProjectFixture } from '../project-fixture-context'

const CONTROLS = {
  state: { type: 'select', label: 'State', options: ['default'], default: 'default' },
} satisfies Record<string, Control>

export function ProjectSkillsTweaked() {
  usePrototype(CONTROLS)
  const project = useProjectFixture()
  useEffect(() => resetSkills(), [])
  const projectId = `${project.owner}/${project.name}`
  return (
    <SkillsPage
      owner={ESkillOwner.Project}
      title="Skills"
      description={`Skills stored for ${projectId}, loaded in threads on this project.`}
      detailHref={(name) => `/projects/${encodeURIComponent(projectId)}/settings/skills/${name}`}
    />
  )
}
