import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  builtInSkillEntry,
  isBuiltInSkillName,
  type BuiltInSkillCatalogueEntry,
} from '@dltech/atlas-harness/skill-catalogue'

let cachedRoot: string | undefined

export function builtInSkillsRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot
  const require = createRequire(import.meta.url)
  const harnessRoot = dirname(require.resolve('@dltech/atlas-harness/package.json'))
  cachedRoot = join(harnessRoot, 'skills')
  return cachedRoot
}

export function isBuiltIn(name: string): boolean {
  return isBuiltInSkillName(name)
}

export function builtInSkill(name: string): BuiltInSkillCatalogueEntry | undefined {
  return builtInSkillEntry(name)
}

export async function readBuiltInFile(args: {
  name: string
  path: string
}): Promise<Uint8Array | undefined> {
  const skill = builtInSkillEntry(args.name)
  if (skill === undefined) return undefined
  const known =
    args.path === skill.entry.path || skill.files.some((file) => file.path === args.path)
  if (!known) return undefined
  const bytes = await readFile(join(builtInSkillsRoot(), skill.name, args.path))
  return new Uint8Array(bytes)
}
