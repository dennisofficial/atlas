export enum EMemoryScope {
  Global = 'global',
  Project = 'project',
}

export enum EMemoryType {
  User = 'user',
  Feedback = 'feedback',
  Project = 'project',
  Reference = 'reference',
}

export const MEMORY_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/
export const MEMORY_PROJECT_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/
export const MAX_MEMORY_DESCRIPTION_CHARS = 300
export const MAX_MEMORY_BODY_CHARS = 20_000
