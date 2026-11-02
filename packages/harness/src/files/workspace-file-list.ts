import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { runGit } from '../workspace/run-git'

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git'])

async function walk(args: { root: string; directory: string }): Promise<string[]> {
  const entries = await readdir(join(args.root, args.directory), { withFileTypes: true }).catch(
    () => [],
  )
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const path = args.directory === '' ? entry.name : `${args.directory}/${entry.name}`
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) return []
        return await walk({ root: args.root, directory: path })
      }
      return [path]
    }),
  )
  return nested.flat()
}

export async function listWorkspaceFiles(args: { root: string }): Promise<string[]> {
  const run = await runGit({
    args: [
      '-c',
      'core.quotepath=off',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ],
    cwd: args.root,
  })
  if (!run.ok) return await walk({ root: args.root, directory: '' })
  return [...new Set(run.stdout.split('\0').filter((path) => path !== ''))]
}
