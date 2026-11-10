import { affectedApps } from '../packages/core/src/version/release-affected'

import { nonEmptyLines, run, workspaceManifests } from './workspace-manifests'

function flagsOf(name: string): string[] {
  const values: string[] = []
  process.argv.forEach((value, at) => {
    const next = process.argv[at + 1]
    if (value === name && next !== undefined) values.push(next)
  })
  return values
}

function changedPathsSince(base: string): readonly string[] | undefined {
  try {
    return nonEmptyLines(run(['git', 'diff', '--name-only', `${base}...HEAD`]))
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const apps = flagsOf('--app')
  const base = flagsOf('--base')[0]
  if (apps.length === 0) throw new Error('pass --app <dir> at least once')

  const paths = base === undefined || /^0+$/.test(base) ? undefined : changedPathsSince(base)
  if (paths === undefined) {
    console.error('no base ref to compare against; the change counts as reaching every app')
    console.log('run=true')
    return
  }

  const reached = affectedApps({
    manifests: await workspaceManifests(),
    apps,
    changedPaths: paths,
  })
  console.error(
    `${reached.join(', ') || 'no app'} reached by ${paths.length} changed ${paths.length === 1 ? 'file' : 'files'}`,
  )
  console.log(`run=${reached.length === 0 ? 'false' : 'true'}`)
}

if (import.meta.main) await main()
