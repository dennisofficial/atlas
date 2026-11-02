import { describe, expect, it } from 'bun:test'

import { SERVE_NICE, SERVE_OOM_SCORE_ADJ, applyServePriority } from '../serve-priority'

const POD_ENV = { ATLAS_API_PROVISIONED: '1' }

const recordingDeps = () => {
  const calls = { oom: [] as number[], nice: [] as number[] }
  return {
    calls,
    deps: {
      writeOomScoreAdj: (value: number) => void calls.oom.push(value),
      setNice: (value: number) => void calls.nice.push(value),
    },
  }
}

describe('applyServePriority', () => {
  it('lowers serve oom score and nice in a linux pod', () => {
    const { calls, deps } = recordingDeps()
    const report = applyServePriority({
      env: POD_ENV,
      platform: 'linux',
      deps,
    })
    expect(report).toEqual({
      enabled: true,
      oomScoreAdj: { applied: true },
      nice: { applied: true },
    })
    expect(calls).toEqual({ oom: [SERVE_OOM_SCORE_ADJ], nice: [SERVE_NICE] })
  })

  it('touches nothing outside a pod', () => {
    const { calls, deps } = recordingDeps()
    expect(applyServePriority({ env: {}, platform: 'linux', deps })).toEqual({
      enabled: false,
    })
    expect(calls).toEqual({ oom: [], nice: [] })
  })

  it('touches nothing off linux', () => {
    const { calls, deps } = recordingDeps()
    expect(applyServePriority({ env: POD_ENV, platform: 'darwin', deps })).toEqual({
      enabled: false,
    })
    expect(calls).toEqual({ oom: [], nice: [] })
  })

  it('reports a refused write and still attempts the other step', () => {
    const { calls, deps } = recordingDeps()
    const report = applyServePriority({
      env: POD_ENV,
      platform: 'linux',
      deps: {
        ...deps,
        writeOomScoreAdj: () => {
          throw new Error('EACCES: permission denied')
        },
      },
    })
    expect(report).toEqual({
      enabled: true,
      oomScoreAdj: { applied: false, error: 'EACCES: permission denied' },
      nice: { applied: true },
    })
    expect(calls.nice).toEqual([SERVE_NICE])
  })
})
