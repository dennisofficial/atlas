import { defineOp, type DaemonGroupFactory } from '../../engine'
import { CallFailureError, ECallFailure, type BranchSet } from '../../ops'

const emptySetFor = (repoPath: string): BranchSet => ({
  repoPath,
  head: null,
  branches: [],
  worktrees: [],
})

export const fakeGitGroup = (): DaemonGroupFactory => {
  const repos = new Map<string, BranchSet>()
  return () => ({
    name: 'git',
    ops: [
      defineOp({
        op: 'git.watch',
        run: async ({ op }) => {
          const set = repos.get(op.repoPath) ?? emptySetFor(op.repoPath)
          repos.set(op.repoPath, set)
          return set
        },
      }),
      defineOp({
        op: 'git.unwatch',
        run: async ({ op }) => {
          repos.delete(op.repoPath)
          return null
        },
      }),
      defineOp({
        op: 'git.read',
        run: async ({ op }) => {
          const set = repos.get(op.repoPath)
          if (set === undefined) {
            throw new CallFailureError({
              code: ECallFailure.NotFound,
              message: `not a git repository: ${op.repoPath}`,
            })
          }
          return set
        },
      }),
    ],
  })
}
