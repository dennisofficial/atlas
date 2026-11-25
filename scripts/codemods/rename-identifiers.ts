import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { extname } from 'node:path'

type RenameMap = {
  identifiers: Record<string, string>
  paths?: Record<string, string>
  include: string[]
  exclude?: string[]
}

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.md', '.json', '.yml', '.yaml'])
const ENCODING = 'utf8'

const parseArgs = (argv: readonly string[]): { mapPath: string; dryRun: boolean } => {
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const mapPath = positional[0]
  if (mapPath === undefined) throw new Error('usage: rename-identifiers.ts <map.json> [--dry-run]')
  return { mapPath, dryRun: argv.includes('--dry-run') }
}

const trackedFiles = (): string[] => {
  const result = spawnSync('git', ['ls-files'], { encoding: ENCODING })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.split('\n').filter((line) => line !== '')
}

const selected = (args: {
  files: readonly string[]
  include: readonly string[]
  exclude: readonly string[]
}): string[] =>
  args.files.filter(
    (file) =>
      args.include.some((prefix) => file.startsWith(prefix)) &&
      !args.exclude.some((prefix) => file.startsWith(prefix)) &&
      TEXT_EXTENSIONS.has(extname(file)),
  )

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const renamerOf = (identifiers: Record<string, string>): ((text: string) => string) => {
  const names = Object.keys(identifiers).sort((left, right) => right.length - left.length)
  const pattern = new RegExp(`\\b(${names.map(escapeRegExp).join('|')})\\b`, 'g')
  return (text) => text.replace(pattern, (matched) => identifiers[matched] ?? matched)
}

const renamePaths = (args: {
  paths: Record<string, string>
  dryRun: boolean
}): Record<string, string> => {
  const applied: Record<string, string> = {}
  for (const [from, to] of Object.entries(args.paths)) {
    if (!args.dryRun) {
      const moved = spawnSync('git', ['mv', from, to], { encoding: ENCODING })
      if (moved.status !== 0) throw new Error(`git mv ${from} ${to}: ${moved.stderr}`)
    }
    applied[from] = to
  }
  return applied
}

const rewrite = (args: {
  files: readonly string[]
  rename: (text: string) => string
  dryRun: boolean
}): { files: number; replacements: number } => {
  let files = 0
  let replacements = 0
  for (const file of args.files) {
    const before = readFileSync(file, ENCODING)
    const after = args.rename(before)
    if (after === before) continue
    const beforeLines = before.split('\n')
    const afterLines = after.split('\n')
    files += 1
    replacements += beforeLines.filter((line, index) => line !== afterLines[index]).length
    if (!args.dryRun) writeFileSync(file, after)
  }
  return { files, replacements }
}

const main = (): void => {
  const args = parseArgs(process.argv.slice(2))
  const map = JSON.parse(readFileSync(args.mapPath, ENCODING)) as RenameMap
  const files = selected({
    files: trackedFiles(),
    include: map.include,
    exclude: map.exclude ?? [],
  })
  const result = rewrite({ files, rename: renamerOf(map.identifiers), dryRun: args.dryRun })
  const paths = renamePaths({ paths: map.paths ?? {}, dryRun: args.dryRun })
  console.log(
    JSON.stringify({
      identifiers: Object.keys(map.identifiers).length,
      files: result.files,
      changedLines: result.replacements,
      paths,
      dryRun: args.dryRun,
    }),
  )
}

main()
