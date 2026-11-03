import { SKILL_TEXT_EXTENSIONS } from '@dltech/atlas-wire/web'

export enum ESkillFileKind {
  Text = 'text',
  Binary = 'binary',
}

export const SKILL_PRECEDENCE_COPY =
  'In a session, a skill in the repository overrides a project skill, which overrides a personal skill with the same name.'

const TEXT_EXTENSIONS = new Set<string>(SKILL_TEXT_EXTENSIONS)

export function fileKindOf(path: string): ESkillFileKind {
  const name = path.split('/').at(-1) ?? path
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  return TEXT_EXTENSIONS.has(ext) ? ESkillFileKind.Text : ESkillFileKind.Binary
}

const SKILL_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

export function formatSkillDate(updatedAt: string): string {
  return SKILL_DATE_FORMAT.format(new Date(updatedAt))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
