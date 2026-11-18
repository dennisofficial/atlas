import { CallInterruptedError } from '@dltech/atlas-core'

export const nullUnlessInterrupted = (error: unknown): null => {
  if (error instanceof CallInterruptedError) throw error
  return null
}
