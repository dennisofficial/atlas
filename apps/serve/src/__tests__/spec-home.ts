import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const withNoRepoSpec = (home: string): string => {
  mkdirSync(join(home, 'bootstrap'), { recursive: true })
  writeFileSync(
    join(home, 'bootstrap', 'workspace-spec.json'),
    JSON.stringify({ remoteUrl: null, githubToken: null }),
  )
  return home
}
