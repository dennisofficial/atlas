import type { VercelSdk } from '@dltech/atlas-wire'
import { vi } from 'bun:test'

type GetParams = Parameters<VercelSdk['get']>[0]

export function fakeSdk(options: { getFailure?: Error; deleteFailure?: Error } = {}) {
  const gets: GetParams[] = []
  const deleted: string[] = []
  const sdk = {
    getOrCreate: vi.fn(async () => {
      throw new Error('the provision rollback never creates a sandbox')
    }),
    get: vi.fn(async (params: GetParams) => {
      gets.push(params)
      if (options.getFailure !== undefined) throw options.getFailure
      return {
        delete: async () => {
          if (options.deleteFailure !== undefined) throw options.deleteFailure
          deleted.push(String(params.name))
        },
      }
    }),
  } as unknown as VercelSdk
  return { sdk, gets, deleted }
}
