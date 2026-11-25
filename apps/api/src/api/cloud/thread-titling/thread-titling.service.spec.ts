import { describe, expect, it, vi } from 'bun:test'
import type { SessionNamer } from '../../../agent'
import { TITLING_TIMEOUT_MS, ThreadTitlingService } from './thread-titling.service'

const REQUEST = { userId: 'usr-1', projectId: 'prj-1', text: 'fix login' }

const serviceWith = (namer: SessionNamer): ThreadTitlingService => new ThreadTitlingService(namer)

describe('ThreadTitlingService', () => {
  it('names a session through the namer under a timeout signal', async () => {
    const namer = vi.fn(async () => 'Fix login')
    const service = serviceWith(namer as unknown as SessionNamer)

    expect(await service.nameOf(REQUEST)).toBe('Fix login')
    const ask = namer.mock.calls[0]?.[0] as { text: string; signal: AbortSignal } | undefined
    expect(ask?.text).toBe('fix login')
    expect(ask?.signal).toBeInstanceOf(AbortSignal)
    expect(TITLING_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('answers null when the namer has no title', async () => {
    const namer = vi.fn(async () => null)
    const service = serviceWith(namer as unknown as SessionNamer)

    expect(await service.nameOf(REQUEST)).toBeNull()
  })
})
