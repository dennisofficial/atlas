import type { ProjectRepo } from '@dltech/atlas-wire'
import { BadRequestException } from '@nestjs/common'

const repoNameOf = (repo: string): string => (repo.split('/')[1] ?? repo).toLowerCase()

export function assertProjectRules(args: {
  repo: string | null
  additionalRepos: readonly ProjectRepo[]
}): void {
  if (args.additionalRepos.length > 0 && args.repo === null) {
    throw new BadRequestException('additional repos require a primary repo')
  }
  const names = [
    ...(args.repo === null ? [] : [repoNameOf(args.repo)]),
    ...args.additionalRepos.map((entry) => repoNameOf(entry.repo)),
  ]
  if (new Set(names).size !== names.length) {
    throw new BadRequestException('repo names must be distinct across the project')
  }
}
