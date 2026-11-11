import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const tempDirs: string[] = []

export const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-artifacts-'))
  tempDirs.push(dir)
  return dir
}

export const writePath = ({
  root,
  path,
  contents,
}: {
  root: string
  path: string
  contents: string
}): string => {
  const absolute = join(root, path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, contents)
  return absolute
}

export const removeTempDirs = (): void => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export const git = ({ dir, argv }: { dir: string; argv: readonly string[] }): void => {
  const result = Bun.spawnSync(['git', '-C', dir, ...argv], { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0)
    throw new Error(`git ${argv.join(' ')} failed: ${result.stderr.toString()}`)
}
