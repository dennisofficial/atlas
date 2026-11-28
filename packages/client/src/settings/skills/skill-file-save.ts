import { fromBase64Utf8, toBase64Utf8 } from './skill-content'
import type { SkillScopeTarget } from './skill-scope'

export type SkillFileTarget = SkillScopeTarget & { skill: string; path: string }
export type SkillFileWrite = SkillFileTarget & {
  content: string
  contentHash: string
  baseRevision?: number
}
export type SkillSaveOutcome =
  | { outcome: 'saved'; revision: number }
  | { outcome: 'conflict'; theirs: string; revision: number }

export const isSkillConflict = (failure: unknown): boolean => {
  if (typeof failure !== 'object' || failure === null) return false
  if ('status' in failure && failure.status === 409) return true
  if (!('data' in failure) || typeof failure.data !== 'object' || failure.data === null)
    return false
  return 'httpStatus' in failure.data && failure.data.httpStatus === 409
}

export const skillFileWriteOf = async ({
  target,
  content,
  baseRevision,
  hashOf,
}: {
  target: SkillFileTarget
  content: string
  baseRevision?: number
  hashOf: (content: string) => Promise<string>
}): Promise<SkillFileWrite> => ({
  ...target,
  content,
  contentHash: await hashOf(content),
  ...(baseRevision === undefined ? {} : { baseRevision }),
})

export const saveSkillTextWith = async ({
  target,
  text,
  hashOf,
  put,
  read,
}: {
  target: SkillFileTarget & { baseRevision: number }
  text: string
  hashOf: (content: string) => Promise<string>
  put: (input: SkillFileWrite) => Promise<number>
  read: (input: SkillFileTarget) => Promise<{ content: string; revision: number }>
}): Promise<SkillSaveOutcome> => {
  const { baseRevision, ...file } = target
  const input = await skillFileWriteOf({
    target: file,
    content: toBase64Utf8(text),
    baseRevision,
    hashOf,
  })
  try {
    return { outcome: 'saved', revision: await put(input) }
  } catch (failure) {
    if (!isSkillConflict(failure)) throw failure
    const fresh = await read(file)
    return { outcome: 'conflict', theirs: fromBase64Utf8(fresh.content), revision: fresh.revision }
  }
}
