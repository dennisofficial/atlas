export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export const MAX_SKILL_NAME_LENGTH = 64

export const EMPTY_SKILL_MD = `---\nname: \ndescription: \n---\n\n`

export const skillNameIsValid = ({ name }: { name: string }): boolean =>
  SKILL_NAME_PATTERN.test(name) && name.length <= MAX_SKILL_NAME_LENGTH
