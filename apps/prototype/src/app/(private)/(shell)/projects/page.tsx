import { Suspense } from 'react'

import { ProjectsRoute } from '@/features/projects/projects-route'

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsRoute />
    </Suspense>
  )
}
