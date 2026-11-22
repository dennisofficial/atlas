import { frontmatterOf, type FrontmatterFields } from './frontmatter'
import { KNOWN_FIELDS, type SkillFrontmatter } from './spec'

const AFFIRMATIVE: readonly string[] = ['1', 'true', 'on', 'yes']
const NEGATIVE: readonly string[] = ['0', 'false', 'off', 'no']

const textAt = (fields: FrontmatterFields, ...keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = fields.get(key)?.trim()
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

const booleanOf = (args: { written: string | undefined; fallback: boolean }): boolean => {
  const word = args.written?.trim().toLowerCase()
  if (word === undefined) return args.fallback
  if (AFFIRMATIVE.includes(word)) return true
  if (NEGATIVE.includes(word)) return false
  return args.fallback
}

const nameOf = (args: { fields: FrontmatterFields; fallbackName: string }): string =>
  (textAt(args.fields, 'name') ?? args.fallbackName).trim().toLowerCase()

const unrecognisedOf = (fields: FrontmatterFields): ReadonlyMap<string, string> => {
  const kept = new Map<string, string>()
  for (const [key, value] of fields) {
    if (!KNOWN_FIELDS.includes(key)) kept.set(key, value)
  }
  return kept
}

export function skillFrontmatterOf(args: {
  fields: FrontmatterFields
  fallbackName: string
}): SkillFrontmatter {
  const { fields } = args
  return {
    name: nameOf(args),
    description: textAt(fields, 'description') ?? '',
    whenToUse: textAt(fields, 'when_to_use', 'when-to-use'),
    userInvocable: booleanOf({ written: textAt(fields, 'user-invocable'), fallback: true }),
    modelInvocable: !booleanOf({
      written: textAt(fields, 'disable-model-invocation'),
      fallback: false,
    }),
    argumentHint: textAt(fields, 'argument-hint'),
    unrecognised: unrecognisedOf(fields),
  }
}

export type ParsedSkillSpec = {
  name: string
  summary: string
  argumentHint?: string
  userInvocable: boolean
}

export function skillSpecOf(args: {
  text: string
  fallbackName: string
}): ParsedSkillSpec | undefined {
  if (args.text.trim() === '') return undefined

  const frontmatter = skillFrontmatterOf({
    fields: frontmatterOf(args.text),
    fallbackName: args.fallbackName,
  })
  const name = frontmatter.name.trim().toLowerCase()
  if (name === '') return undefined

  const hint = frontmatter.argumentHint?.trim()
  return {
    name,
    summary: frontmatter.description,
    ...(hint === undefined || hint === '' ? {} : { argumentHint: hint }),
    userInvocable: frontmatter.userInvocable,
  }
}
