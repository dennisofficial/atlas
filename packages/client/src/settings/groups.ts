import { PROJECT_GROUP_NAME_MAX, type Project } from '@dltech/atlas-wire/web'

export const GROUP_DESCRIPTION =
  'A group shares secrets, files, settings, skills and MCP servers with every project in it. A project belongs to one group.'

export const GROUP_DELETE_DESCRIPTION =
  "Its projects become ungrouped. The group's secrets, files, settings, skills and MCP servers are deleted."

export const groupNameProblem = ({ name }: { name: string }): string | null => {
  const trimmed = name.trim()
  if (trimmed === '') return 'Give the group a name.'
  if (trimmed.length > PROJECT_GROUP_NAME_MAX) {
    return `Keep the name to ${String(PROJECT_GROUP_NAME_MAX)} characters.`
  }
  return null
}

export const groupMembersOf = ({
  projects,
  groupId,
}: {
  projects: readonly Project[]
  groupId: string
}): Project[] => projects.filter((project) => project.groupId === groupId)

export const groupCandidatesOf = ({
  projects,
  groupId,
}: {
  projects: readonly Project[]
  groupId: string
}): Project[] => projects.filter((project) => project.groupId !== groupId)

export const groupMemberSummaryOf = (count: number): string => {
  if (count === 0) return 'No projects in this group yet.'
  return `${String(count)} ${count === 1 ? 'project' : 'projects'}`
}
