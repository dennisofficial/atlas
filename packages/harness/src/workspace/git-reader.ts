import type { GitRun } from './run-git'

export type GitReader = (args: { args: readonly string[]; cwd: string }) => Promise<GitRun>
