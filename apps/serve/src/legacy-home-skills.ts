import { readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { ESkillRootFlavour } from '@dltech/atlas-core'

import { fileEntry, COMPATIBILITY_SKILL_FLAVOURS, type ContextEntry } from './context-entries'
import { messageOf } from './context-readiness'
import { hasErrorCode } from './workspace-files'

export type LegacyHomeSkills = { present: ReadonlySet<ESkillRootFlavour>; entries: readonly ContextEntry[] }

export type LegacyHomeOutcome = { skills: LegacyHomeSkills } | { failed: string }

const statOrNull = async (path: string) => {
  try {
    return await stat(path)
  } catch (error) {
    if (hasErrorCode({ error, code: 'ENOENT' }) || hasErrorCode({ error, code: 'ELOOP' })) return null
    throw error
  }
}

const walk = async (args: {
  directory: string
  key: string
  ancestors: ReadonlySet<string>
  into: ContextEntry[]
}): Promise<void> => {
  const real = await realpath(args.directory)
  if (args.ancestors.has(real)) return
  const ancestors = new Set(args.ancestors).add(real)

  for (const dirent of await readdir(args.directory, { withFileTypes: true })) {
    const path = join(args.directory, dirent.name)
    const key = `${args.key}/${dirent.name}`
    const info = dirent.isSymbolicLink() ? await statOrNull(path) : dirent
    if (info === null) continue
    if (info.isDirectory()) {
      await walk({ directory: path, key, ancestors, into: args.into })
    } else if (info.isFile()) {
      args.into.push(fileEntry({ key, path }))
    }
  }
}

export const readLegacyHomeSkills = async (home: string): Promise<LegacyHomeOutcome> => {
  const present = new Set<ESkillRootFlavour>()
  const entries: ContextEntry[] = []
  for (const flavour of COMPATIBILITY_SKILL_FLAVOURS) {
    const root = join(home, flavour, 'skills')
    try {
      const info = await statOrNull(root)
      if (info === null) continue
      if (!info.isDirectory()) throw new Error('not a directory')
      present.add(flavour)
      await walk({ directory: root, key: `${flavour}/skills`, ancestors: new Set(), into: entries })
    } catch (error) {
      return { failed: `could not read ${root}: ${messageOf(error)}` }
    }
  }
  return { skills: { present, entries } }
}
