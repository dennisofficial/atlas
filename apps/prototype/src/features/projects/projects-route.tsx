'use client'

import { usePrototype, type Control } from '@/proto/use-prototype'

import { PROJECT_OWNERS } from './projects.fixtures'
import { ProjectsView } from './projects-view'

const ALL_OWNERS = 'all'

const PROJECTS_CONTROLS = {
  owner: {
    type: 'select',
    label: 'Owner',
    options: [ALL_OWNERS, ...PROJECT_OWNERS.map((owner) => owner.id)],
    default: ALL_OWNERS,
  },
} satisfies Record<string, Control>

export function ProjectsRoute() {
  const { owner } = usePrototype(PROJECTS_CONTROLS)
  return <ProjectsView key={owner} initialOwnerId={owner === ALL_OWNERS ? null : owner} />
}
