import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const readTextOrEmpty = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

const namesIn = async (path: string): Promise<readonly string[]> => {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

export const readReflogs = async (args: { gitDir: string }): Promise<readonly string[]> => {
  const worktreeNames = await namesIn(join(args.gitDir, 'worktrees'))
  const paths = [
    join(args.gitDir, 'logs', 'HEAD'),
    ...worktreeNames.map((name) => join(args.gitDir, 'worktrees', name, 'logs', 'HEAD')),
  ]
  const texts = await Promise.all(paths.map(readTextOrEmpty))
  return texts.filter((text) => text !== '')
}
