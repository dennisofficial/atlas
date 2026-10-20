import { normalizeRepoOrigin } from '@dltech/atlas-core'

import { runGit } from '../workspace/run-git'

export async function readOriginIdentity(repoRoot: string): Promise<string | null> {
  const run = await runGit({ args: ['remote', 'get-url', 'origin'], cwd: repoRoot })
  if (!run.ok) return null
  const url = run.stdout.trim()
  return url === '' ? null : normalizeRepoOrigin(url)
}
