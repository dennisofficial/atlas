export interface IProjectOption {
  id: string
  name: string
}

export const NO_PROJECT_LABEL = 'No project'

export const projectLabelOf = (args: {
  projects: readonly IProjectOption[]
  projectId: string | null
}): string =>
  args.projects.find((project) => project.id === args.projectId)?.name ?? NO_PROJECT_LABEL
