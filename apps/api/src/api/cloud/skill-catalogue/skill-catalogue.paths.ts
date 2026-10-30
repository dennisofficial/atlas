import { EDefinitionOrigin, skillRootPlan } from '@dltech/atlas-core'

const SKILL_ENTRY = 'skill.md'
const SKILLS_DIRECTORY_NAME = 'skills'
const REPO_ROOT = '/'
const MARKDOWN = '.md'

export const repoSkillRoots: readonly string[] = skillRootPlan({
  atlasHome: REPO_ROOT,
  home: REPO_ROOT,
  cwd: REPO_ROOT,
  skillsDirectoryName: SKILLS_DIRECTORY_NAME,
})
  .filter((root) => root.origin === EDefinitionOrigin.Project)
  .map((root) => root.directory.replace(/^\/+/, ''))

export type SkillFile = { path: string; fallbackName: string }

export const folderSkillOf = (args: { path: string; root: string }): SkillFile | undefined => {
  const prefix = `${args.root}/`
  if (!args.path.startsWith(prefix)) return undefined
  const [folder, file, ...rest] = args.path.slice(prefix.length).split('/')
  if (folder === undefined || file === undefined || rest.length > 0) return undefined
  if (file.toLowerCase() !== SKILL_ENTRY) return undefined
  return { path: args.path, fallbackName: folder }
}

export const userSkillOf = (path: string): SkillFile | undefined => {
  const [first, second, ...rest] = path.split('/')
  if (first === undefined || rest.length > 0) return undefined
  if (second === undefined) {
    return first.toLowerCase().endsWith(MARKDOWN)
      ? { path, fallbackName: first.slice(0, -MARKDOWN.length) }
      : undefined
  }
  return second.toLowerCase() === SKILL_ENTRY ? { path, fallbackName: first } : undefined
}
