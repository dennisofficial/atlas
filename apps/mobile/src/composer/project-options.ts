export interface IProjectOption {
  id: string
  name: string
}

export interface IProjectChoice {
  value: string
  label: string
}

export const NO_PROJECT_LABEL = 'No project'
export const NO_PROJECT_CHOICE = '__no-project__'

export const projectChoicesOf = (projects: readonly IProjectOption[]): IProjectChoice[] => [
  { value: NO_PROJECT_CHOICE, label: NO_PROJECT_LABEL },
  ...projects.map((project) => ({ value: project.id, label: project.name })),
]

export const projectIdOfChoice = (value: string): string | null =>
  value === NO_PROJECT_CHOICE ? null : value

export const projectChoiceOf = (projectId: string | null): string => projectId ?? NO_PROJECT_CHOICE

export const projectLabelOf = (args: {
  projects: readonly IProjectOption[]
  projectId: string | null
}): string =>
  args.projects.find((project) => project.id === args.projectId)?.name ?? NO_PROJECT_LABEL
