import {
  ESkillWarning,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  type SkillFrontmatter,
  type SkillWarning,
} from './spec'

const NAME_CHARSET = /^[a-z0-9-]+$/

const nameWarnings = (args: {
  name: string
  directoryName: string | undefined
}): readonly SkillWarning[] => {
  const { name } = args
  if (name === '') return [{ code: ESkillWarning.MissingName, detail: 'no name was declared' }]

  const warnings: SkillWarning[] = []

  if (name.length > SKILL_NAME_MAX_LENGTH) {
    warnings.push({
      code: ESkillWarning.NameTooLong,
      detail: `name is ${name.length} characters, over the ${SKILL_NAME_MAX_LENGTH} allowed`,
    })
  }
  if (!NAME_CHARSET.test(name)) {
    warnings.push({
      code: ESkillWarning.NameCharset,
      detail: `name "${name}" may hold only lowercase letters, digits and hyphens`,
    })
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    warnings.push({
      code: ESkillWarning.NameHyphenEdges,
      detail: `name "${name}" starts or ends with a hyphen`,
    })
  }
  if (name.includes('--')) {
    warnings.push({
      code: ESkillWarning.NameDoubleHyphen,
      detail: `name "${name}" holds a double hyphen`,
    })
  }
  if (args.directoryName !== undefined && name !== args.directoryName) {
    warnings.push({
      code: ESkillWarning.NameDirectoryMismatch,
      detail: `name "${name}" does not match its directory "${args.directoryName}"`,
    })
  }

  return warnings
}

const descriptionWarnings = (frontmatter: SkillFrontmatter): readonly SkillWarning[] => {
  const { description } = frontmatter
  const warnings: SkillWarning[] = []

  if (description === '') {
    warnings.push({ code: ESkillWarning.MissingDescription, detail: 'no description was declared' })
  }
  if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    warnings.push({
      code: ESkillWarning.DescriptionTooLong,
      detail: `description is ${description.length} characters, over the ${SKILL_DESCRIPTION_MAX_LENGTH} allowed`,
    })
  }

  return warnings
}

const unrecognisedWarnings = (frontmatter: SkillFrontmatter): readonly SkillWarning[] =>
  [...frontmatter.unrecognised.keys()].map((key) => ({
    code: ESkillWarning.UnknownField,
    detail: `"${key}" is not a field Atlas reads`,
  }))

export function validateSkill(args: {
  frontmatter: SkillFrontmatter
  directoryName: string | undefined
}): readonly SkillWarning[] {
  return [
    ...nameWarnings({ name: args.frontmatter.name, directoryName: args.directoryName }),
    ...descriptionWarnings(args.frontmatter),
    ...unrecognisedWarnings(args.frontmatter),
  ]
}
