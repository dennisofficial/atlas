import { parseFrontmatter, skillFrontmatterOf } from '@dltech/atlas-core'

import type { BuiltInSkillSpec } from './types'

const SKILL_ENTRY = 'skill.md'

export type ParsedSkillSpec = { spec: BuiltInSkillSpec; userInvocable: boolean }

export function skillFallbackNameOf(path: string): string {
  const parts = path.split('/')
  const file = parts[parts.length - 1] ?? ''
  if (file.toLowerCase() === SKILL_ENTRY) return parts[parts.length - 2] ?? ''
  const dot = file.lastIndexOf('.')
  return dot <= 0 ? file : file.slice(0, dot)
}

export function parseSkillSpec(args: {
  text: string
  fallbackName: string
}): ParsedSkillSpec | undefined {
  if (args.text.trim() === '') return undefined

  const { document } = parseFrontmatter(args.text)
  const frontmatter = skillFrontmatterOf({ document, fallbackName: args.fallbackName })
  const name = frontmatter.name.trim().toLowerCase()
  if (name === '') return undefined

  const hint = frontmatter.argumentHint?.trim()
  return {
    spec: {
      name,
      summary: frontmatter.description,
      ...(hint === undefined || hint === '' ? {} : { argumentHint: hint }),
    },
    userInvocable: frontmatter.userInvocable,
  }
}
