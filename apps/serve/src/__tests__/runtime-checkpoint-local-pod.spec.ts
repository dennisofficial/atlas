import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ERuntimePhase } from '@dltech/atlas-wire'

import { captureFor, fakeFetch, saidEvent } from './runtime-checkpoint-fixture'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-checkpoint-local-'))
  homes.push(home)
  return home
}

describe('runtime checkpoint on a local pod', () => {
  it('captures and persists locally but issues no HTTP, and parks without a mirror', async () => {
    const requests: unknown[] = []
    const capture = captureFor({
      home: scratchHome(),
      events: [saidEvent({ id: 'a', seq: 1 })],
      cloudURL: 'http://127.0.0.1:9',
      env: { ATLAS_POD_NAME: 'atlas-pod-1', ATLAS_SERVE_TOKEN: 't' },
      fetchFn: fakeFetch(async (input) => {
        requests.push(input)
        throw new Error('no API call expected')
      }),
    })

    await capture.capture({ phase: ERuntimePhase.Serving })
    await capture.capture({ phase: ERuntimePhase.Parking, attempts: 1 })
    const parked = await capture.capture({ phase: ERuntimePhase.Parked })
    await capture.flush({ timeoutMs: 1_000 })

    expect(parked?.phase).toBe(ERuntimePhase.Parked)
    expect((await capture.readPersisted())?.phase).toBe(ERuntimePhase.Parked)
    expect(requests).toEqual([])
  })
})
