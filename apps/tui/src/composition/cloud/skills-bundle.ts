import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

import { EDefinitionOrigin, skillRootPlan } from '@dltech/atlas-core'
import { atlasDirectory, resolveSkillRoots } from '@dltech/atlas-harness'

export const MAX_SKILLS_BUNDLE_BYTES = 4 * 1024 * 1024

const SKILLS_DIRECTORY_NAME = 'skills'

const walk = async (directory: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(directory, { recursive: true, withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name))
  } catch {
    return []
  }
}

/**
 * The operator's user-level skill roots as a JSON map of `<flavour>/skills/<path>` to base64
 * content — the serve unpacks it into its own home, so a cloud thread sees the same skills as
 * this machine. Project-level skills ride the git transfer and are not duplicated here. Returns
 * undefined when there is nothing to carry, and drops the bundle rather than the lift when it
 * outgrows the wire limit.
 */
export async function captureSkillsBundle(): Promise<string | undefined> {
  const roots = await resolveSkillRoots({
    plan: skillRootPlan({
      atlasHome: atlasDirectory(),
      home: homedir(),
      cwd: homedir(),
      skillsDirectoryName: SKILLS_DIRECTORY_NAME,
    }),
  })

  const files: Record<string, string> = {}
  for (const root of roots) {
    if (root.origin !== EDefinitionOrigin.User) continue
    for (const path of await walk(root.directory)) {
      const key = `${root.flavour}/${SKILLS_DIRECTORY_NAME}/${relative(root.directory, path)}`
      files[key] = (await readFile(path)).toString('base64')
    }
  }

  if (Object.keys(files).length === 0) return undefined
  const bundle = JSON.stringify(files)
  if (Buffer.byteLength(bundle, 'utf8') > MAX_SKILLS_BUNDLE_BYTES) return undefined
  return bundle
}
