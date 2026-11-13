import type { Project, ProjectRepoTracking } from '@dltech/atlas-wire'
import { readRepoTracking, type RepoTracking } from '../github/github-repo-coverage'

export async function withRepoTracking(args: { project: Project }): Promise<Project> {
  return {
    ...args.project,
    repos: repoTrackingOf({ project: args.project, tracking: await readRepoTracking() }),
  }
}

function repoTrackingOf(args: { project: Project; tracking: RepoTracking }): ProjectRepoTracking[] {
  const bindings = [
    ...(args.project.repo === null
      ? []
      : [{ repo: args.project.repo, branch: args.project.baseBranch }]),
    ...args.project.additionalRepos,
  ]
  return bindings.map((binding) => ({
    repo: binding.repo,
    ...(binding.branch === null || binding.branch === undefined ? {} : { branch: binding.branch }),
    tracking: args.tracking.trackingOf(binding.repo),
  }))
}
