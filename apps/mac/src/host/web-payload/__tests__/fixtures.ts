import type { IWebPayloadFs } from '../install'
import type { WebManifest } from '../manifest'
import type { IPayloadState } from '../state'

export function manifestOf(overrides: Partial<WebManifest> = {}): WebManifest {
  return {
    schemaVersion: 1,
    hash: '0123456789abcdef',
    artifact: 'web-0123456789abcdef.tar.gz',
    sha256: 'a'.repeat(64),
    size: 3,
    builtAt: '2026-11-09T00:00:00.000Z',
    requiresShell: 1,
    ...overrides,
  }
}

export function fakePayloadFs({
  state = {},
  complete = [],
  failStage = false,
}: {
  state?: IPayloadState
  complete?: string[]
  failStage?: boolean
} = {}) {
  const calls: string[] = []
  const promoted = new Set(complete)
  const staged = new Set<string>()
  let current = state
  const fs: IWebPayloadFs = {
    readState: async () => current,
    writeState: async ({ state: next }) => {
      calls.push('write-state')
      current = next
    },
    isComplete: ({ hash }) => promoted.has(hash),
    stage: async ({ hash }) => {
      calls.push(`stage:${hash}`)
      if (failStage) throw new Error('tar failed')
      staged.add(hash)
    },
    promote: async ({ hash }) => {
      calls.push(`promote:${hash}`)
      staged.delete(hash)
      promoted.add(hash)
    },
    discard: ({ hash }) => {
      calls.push(`discard:${hash}`)
      staged.delete(hash)
      promoted.delete(hash)
    },
    list: () => [...promoted, ...staged],
  }
  return { fs, calls, state: () => current, promoted }
}
