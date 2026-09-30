import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { MemorySecretsStore } from '../../secrets/memory-store'
import { sandboxServeTokenFor, sandboxServeTokenName } from '../sandbox-attachment'

const THREAD = toThreadId('brn_cloud')

const secretsWith = (secrets: Record<string, string> = {}): MemorySecretsStore =>
  new MemorySecretsStore({ label: 'test', secrets })

describe('sandboxServeTokenFor', () => {
  it('mints a 64-hex token and persists it under the thread-scoped name', () => {
    const secrets = secretsWith()

    const token = sandboxServeTokenFor({ secrets, threadId: THREAD })

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(secrets.read(sandboxServeTokenName(THREAD))).toBe(token)
  })

  it('reuses the stored token rather than minting again', () => {
    const secrets = secretsWith({ [sandboxServeTokenName(THREAD)]: 'stable-token' })

    expect(sandboxServeTokenFor({ secrets, threadId: THREAD })).toBe('stable-token')
    expect(sandboxServeTokenFor({ secrets, threadId: THREAD })).toBe('stable-token')
  })

  it('mints a fresh token when the stored one is empty', () => {
    const secrets = secretsWith({ [sandboxServeTokenName(THREAD)]: '' })

    const token = sandboxServeTokenFor({ secrets, threadId: THREAD })

    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('scopes tokens per thread', () => {
    const other = toThreadId('brn_other')
    const secrets = secretsWith()

    const first = sandboxServeTokenFor({ secrets, threadId: THREAD })
    const second = sandboxServeTokenFor({ secrets, threadId: other })

    expect(first).not.toBe(second)
  })
})
