import type { SessionReader } from './fork-chain'
import type { ThreadCheckoutDto } from './sessions.types'
import type { ThreadWithSession } from './thread-with-session'

const CLOUD_EXECUTION_LOCATION = 'cloud'

export async function baseBranchCheckouts(args: {
  reader: SessionReader
  rows: readonly ThreadWithSession[]
}): Promise<Map<string, ThreadCheckoutDto>> {
  const cloud = args.rows.filter(
    ({ session }) =>
      session.executionLocation === CLOUD_EXECUTION_LOCATION && session.projectId !== null,
  )
  const projectIds = [...new Set(cloud.flatMap(({ session }) => session.projectId ?? []))]
  const checkouts = new Map<string, ThreadCheckoutDto>()
  if (projectIds.length === 0) return checkouts

  const projects = await args.reader.orm.public.Project.where((project) =>
    project.id.in(projectIds),
  )
    .select('id', 'baseBranch')
    .all()
  const baseBranchOf = new Map(projects.map(({ id, baseBranch }) => [id, baseBranch]))
  for (const { thread, session } of cloud) {
    const branch = baseBranchOf.get(session.projectId ?? '')
    if (typeof branch === 'string')
      checkouts.set(thread.id, { path: null, branch, detached: false })
  }
  return checkouts
}
