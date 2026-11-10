import type { Routine } from '@dltech/atlas-protocol'
import type { Project } from '@dltech/atlas-wire/web'

export interface RoutineGroup {
  key: string
  name: string
  routines: readonly Routine[]
}

export const routineGroupsOf = (args: {
  routines: readonly Routine[]
  projects: readonly Project[]
}): readonly RoutineGroup[] => {
  const names = new Map(args.projects.map((project) => [project.id, project.name]))
  const order = [
    ...args.projects.map((project) => project.id),
    ...args.routines.map((routine) => routine.projectId),
  ]
  const seen = new Set<string>()
  const groups: RoutineGroup[] = []
  for (const projectId of order) {
    if (seen.has(projectId)) continue
    const routines = args.routines.filter((routine) => routine.projectId === projectId)
    if (routines.length === 0) continue
    seen.add(projectId)
    groups.push({ key: projectId, name: names.get(projectId) ?? projectId, routines })
  }
  return groups
}
