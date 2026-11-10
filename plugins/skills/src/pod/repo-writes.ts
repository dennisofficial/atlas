import { dirname, join } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { REPO_SKILL_ROOTS } from './repo-source'
import { mkdirOf, removeOf, statOf, writeTextOf } from './daemon'

export const SKILL_ENTRY_PATH = 'SKILL.md'

export const REPO_SKILL_ROOT = REPO_SKILL_ROOTS[0] ?? '.atlas/skills'

type Ctx = Pick<PluginPodContext, 'call'>

export type RepoWriteResult = { ok: true; path: string } | { ok: false; reason: string }

const NO_CLONE =
  'this session has no clone, so it has no <repo>/.atlas/skills directory to write; use layer user or layer project instead'

export const hasClone = async (args: { ctx: Ctx; projectDirectory: string }): Promise<boolean> => {
  if (args.projectDirectory === '') return false
  const found = await statOf({ ctx: args.ctx, path: join(args.projectDirectory, '.git') })
  return found.ok
}

export const repoSkillDirectoryOf = (args: { projectDirectory: string; name: string }): string =>
  join(args.projectDirectory, REPO_SKILL_ROOT, args.name)

export const writeRepoSkillFile = async (args: {
  ctx: Ctx
  projectDirectory: string
  name: string
  path: string
  body: string
}): Promise<RepoWriteResult> => {
  if (!(await hasClone({ ctx: args.ctx, projectDirectory: args.projectDirectory })))
    return { ok: false, reason: NO_CLONE }

  const directory = repoSkillDirectoryOf({
    projectDirectory: args.projectDirectory,
    name: args.name,
  })
  const target = join(directory, args.path)

  const made = await mkdirOf({ ctx: args.ctx, path: dirname(target) })
  if (!made.ok) return { ok: false, reason: made.reason }

  const written = await writeTextOf({ ctx: args.ctx, path: target, content: args.body })
  if (!written.ok) return { ok: false, reason: written.reason }
  return { ok: true, path: target }
}

export const removeRepoSkillDirectory = async (args: {
  ctx: Ctx
  projectDirectory: string
  directory: string
}): Promise<RepoWriteResult> => {
  if (!(await hasClone({ ctx: args.ctx, projectDirectory: args.projectDirectory })))
    return { ok: false, reason: NO_CLONE }

  const removed = await removeOf({ ctx: args.ctx, path: args.directory })
  if (!removed.ok) return { ok: false, reason: removed.reason }
  return { ok: true, path: args.directory }
}
