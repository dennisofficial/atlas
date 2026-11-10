import { afterEach, describe, expect, it } from 'bun:test'

import {
  fakeFetch,
  mutationUrl,
  queryUrl,
  trpcOk,
} from '@/features/threads/data/__tests__/trpc-fake'

import { fetchRoutineRuns, fetchRoutines, runRoutineNow } from '../data/routines-api'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('routines api', () => {
  it('lists the routines', async () => {
    const calls = fakeFetch(() => trpcOk({ routines: [] }))

    expect(await fetchRoutines()).toEqual([])
    expect(calls[0]?.url).toBe(queryUrl({ procedure: 'routines.list', input: {} }))
  })

  it('reads a routine runs page', async () => {
    const calls = fakeFetch(() => trpcOk({ runs: [] }))

    expect(await fetchRoutineRuns('rte-1')).toEqual([])
    expect(calls[0]?.url).toBe(
      queryUrl({ procedure: 'routines.runs', input: { routineId: 'rte-1', limit: 20 } }),
    )
  })

  it('runs a routine now and returns the session it started', async () => {
    const calls = fakeFetch(() => trpcOk({ sessionId: 'ses-9' }))

    expect(await runRoutineNow('rte-1')).toEqual({ sessionId: 'ses-9' })
    expect(calls[0]?.url).toBe(mutationUrl('routines.runNow'))
    expect(calls[0]?.body).toEqual({ routineId: 'rte-1' })
  })
})
