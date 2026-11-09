export enum ESkillOrigin {
  BuiltIn = 'builtin',
  CloudUser = 'cloud-user',
  CloudProject = 'cloud-project',
  Repo = 'repo',
}

export enum ESkillWarning {
  MissingName = 'missing-name',
  MissingDescription = 'missing-description',
  NameTooLong = 'name-too-long',
  NameCharset = 'name-charset',
  NameHyphenEdges = 'name-hyphen-edges',
  NameDoubleHyphen = 'name-double-hyphen',
  NameDirectoryMismatch = 'name-directory-mismatch',
  DescriptionTooLong = 'description-too-long',
  UnknownField = 'unknown-field',
}

export const SKILL_NAME_MAX_LENGTH = 64

export const SKILL_DESCRIPTION_MAX_LENGTH = 1024

export type SkillWarning = { code: ESkillWarning; detail: string }

export type SkillFrontmatter = {
  name: string
  description: string
  whenToUse: string | undefined
  userInvocable: boolean
  modelInvocable: boolean
  argumentHint: string | undefined
  unrecognised: ReadonlyMap<string, string>
}

export const KNOWN_FIELDS: readonly string[] = [
  'name',
  'description',
  'when_to_use',
  'when-to-use',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
  'disallowed-tools',
  'argument-hint',
  'arguments',
  'user-invocable',
  'disable-model-invocation',
  'model',
  'effort',
  'context',
  'agent',
  'background',
  'paths',
  'shell',
]
