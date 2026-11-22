import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  builtInSkillEntry,
  builtInSkillsRoot as pluginBuiltInSkillsRoot,
  isBuiltInSkillName,
  type BuiltInSkillCatalogueEntry,
} from '@dltech/atlas-plugin-skills/pod'
import { BUILT_IN_SKILLS_DIRECTORY } from './builtin-skills-directory'

let cachedRoot: string | undefined

export function builtInSkillsRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot
  const bundled = join(dirname(fileURLToPath(import.meta.url)), BUILT_IN_SKILLS_DIRECTORY)
  cachedRoot = existsSync(bundled) ? bundled : pluginBuiltInSkillsRoot()
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
