import { captureGit } from './capture-git'
import { presentObjects } from './capture-present-objects'

const GITLINK_MODE = '160000'
const STAGE_ENTRY = /^(\d+) ([0-9a-f]{40,64}) \d\t/

export async function indexedObjectSeeds({ cwd }: { cwd: string }): Promise<string[]> {
  const run = await captureGit({ args: ['ls-files', '--stage', '-z'], cwd })
  if (!run.ok) throw new Error(`Cannot read the git index of ${cwd}: ${run.stderr.trim()}`)
  const ids = new Set<string>()
  for (const entry of run.stdout.split('\0')) {
    const match = STAGE_ENTRY.exec(entry)
    if (match?.[1] !== undefined && match[2] !== undefined && match[1] !== GITLINK_MODE) ids.add(match[2])
  }
  return presentObjects({ cwd, ids, scratchPrefix: 'atlas-index-seeds-', subject: 'indexed objects' })
}
