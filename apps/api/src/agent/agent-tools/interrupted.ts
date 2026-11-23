import { CallInterruptedError } from '@dltech/atlas-core'

const MISSING_CODES: readonly string[] = ['ENOENT', 'ENOTDIR']

const codeOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const { code } = error as { code?: unknown }
  return typeof code === 'string' ? code : undefined
}

export const nullIfMissing = (error: unknown): null => {
  if (error instanceof CallInterruptedError) throw error
  const code = codeOf(error)
  if (code !== undefined && MISSING_CODES.includes(code)) return null
  throw error
}
