import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { ServeLogLine } from '../serve-log'
import { captureFor, fakeFetch } from './runtime-checkpoint-fixture'
import { trpcFailure, trpcOk } from './trpc-fake'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-checkpoint-spec-'))
  homes.push(home)
  return home
}

describe('runtime checkpoint mirror failures', () => {
  it('logs any other refusal with the status the control plane answered', async () => {
    const home = scratchHome()
    const lines: ServeLogLine[] = []
    const clock = { at: 1_000_000 }
    const capture = captureFor({
      home,
      lines,
      cloudURL: 'http://127.0.0.1:9',
      now: () => clock.at,
      fetchFn: fakeFetch(async () => trpcFailure({ status: 500, message: 'boom' })),
    })

    await capture.capture({ phase: ERuntimePhase.Serving })
    await capture.flush({ timeoutMs: 1_000 })

    const failures = lines.filter((line) => line.event === 'serve.checkpoint-mirror-failed')
    expect(failures).toHaveLength(1)
    expect(JSON.stringify(failures[0])).toContain('500')
  })

  it('logs a thrown transport error and keeps mirroring afterwards', async () => {
    const home = scratchHome()
    const lines: ServeLogLine[] = []
    const sent: number[] = []
    let failNext = true
    const capture = captureFor({
      home,
      lines,
      cloudURL: 'http://127.0.0.1:9',
      fetchFn: fakeFetch(async (_input: unknown, init?: RequestInit) => {
        if (failNext) {
          failNext = false
          throw new Error('socket hang up')
        }
        sent.push((JSON.parse(String(init?.body)) as RuntimeCheckpoint).revision)
        return trpcOk(null)
      }),
    })

    await capture.capture({ phase: ERuntimePhase.Parking, attempts: 1 })
    await capture.flush({ timeoutMs: 1_000 })
    await capture.capture({ phase: ERuntimePhase.Parked })
    await capture.flush({ timeoutMs: 1_000 })

    expect(JSON.stringify(lines)).toContain('socket hang up')
    expect(sent).toEqual([2])
  })

  it('clears a missing registration once a mirror succeeds, so the cadence applies again', async () => {
    const home = scratchHome()
    const clock = { at: 1_000_000 }
    const replies = [404, 200, 200]
    const sent: number[] = []
    const capture = captureFor({
      home,
      cloudURL: 'http://127.0.0.1:9',
      now: () => clock.at,
      fetchFn: fakeFetch(async (_input: unknown, init?: RequestInit) => {
        sent.push((JSON.parse(String(init?.body)) as RuntimeCheckpoint).revision)
        const status = replies.shift() ?? 200
        return status === 404 ? trpcFailure({ status, message: 'gone' }) : trpcOk(null)
      }),
    })

    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

    await capture.capture({ phase: ERuntimePhase.Serving })
    await settle()
    expect(sent).toEqual([1])
    await capture.capture({ phase: ERuntimePhase.Serving })
    await settle()
    expect(sent).toEqual([1, 2])
    await capture.capture({ phase: ERuntimePhase.Serving })
    await settle()
    expect(sent).toEqual([1, 2])
  })
})
