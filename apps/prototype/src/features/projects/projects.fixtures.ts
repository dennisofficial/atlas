export interface ProjectSummary {
  id: string
  owner: string
  name: string
  description?: string
  updated: string
  threads: number
  activity: number[]
}

export const PROJECTS: ProjectSummary[] = [
  {
    id: 'dennisofficial/atlas',
    owner: 'dennisofficial',
    name: 'atlas',
    description: 'Coding-agent harness: the loop, the TUI, and Atlas Cloud.',
    updated: 'Updated today',
    threads: 14,
    activity: [2, 3, 2, 5, 4, 7, 6, 9, 8, 12, 10, 14, 11, 15],
  },
  {
    id: 'dennisofficial/rs-crm',
    owner: 'dennisofficial',
    name: 'rs-crm',
    description: 'Service tickets and billing for Recycling Solution.',
    updated: 'Updated 2d ago',
    threads: 6,
    activity: [0, 1, 0, 2, 3, 1, 4, 2, 0, 1, 3, 5, 2, 1],
  },
  {
    id: 'compai/comp-v2',
    owner: 'compai',
    name: 'comp-v2',
    description: 'Compliance automation platform, maintenance branch.',
    updated: 'Updated 5d ago',
    threads: 9,
    activity: [6, 5, 7, 4, 5, 3, 4, 2, 3, 2, 1, 2, 1, 1],
  },
  {
    id: 'compai/comp-v3',
    owner: 'compai',
    name: 'comp-v3',
    updated: 'Updated yesterday',
    threads: 23,
    activity: [3, 4, 6, 5, 8, 9, 7, 11, 10, 13, 12, 16, 14, 18],
  },
  {
    id: 'compai/csa',
    owner: 'compai',
    name: 'csa',
    description: 'Customer success agent: onboarding and Slack triage.',
    updated: 'Updated 3d ago',
    threads: 4,
    activity: [1, 0, 2, 1, 3, 2, 2, 4, 3, 2, 5, 3, 4, 3],
  },
]

export function filterProjects(input: {
  projects: ProjectSummary[]
  query: string
}): ProjectSummary[] {
  const needle = input.query.trim().toLowerCase()
  return input.projects.filter((project) => {
    if (!needle) return true
    const haystack = `${project.owner}/${project.name} ${project.description ?? ''}`.toLowerCase()
    return haystack.includes(needle)
  })
}
