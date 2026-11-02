import { describe, expect, it } from 'bun:test'

import {
  WORKLOAD_NICE,
  WORKLOAD_OOM_SCORE_ADJ,
  demotedCommand,
  preludeScript,
  workloadPolicy,
} from '../workload-priority'

const POD_ENV = { ATLAS_API_PROVISIONED: '1' }
const NICE_ONLY = { nice: WORKLOAD_NICE, oomScoreAdj: null }
const BOTH = { nice: WORKLOAD_NICE, oomScoreAdj: WORKLOAD_OOM_SCORE_ADJ }

describe('workloadPolicy', () => {
  it('raises the oom score only on linux inside an api-provisioned pod', () => {
    expect(workloadPolicy({ env: POD_ENV, platform: 'linux' })).toEqual(BOTH)
  })

  it('leaves the oom score alone outside a pod', () => {
    expect(workloadPolicy({ env: {}, platform: 'linux' })).toEqual(NICE_ONLY)
  })

  it('leaves the oom score alone in a local docker pod', () => {
    const env = { ...POD_ENV, ATLAS_POD_NAME: 'pod-1' }
    expect(workloadPolicy({ env, platform: 'linux' })).toEqual(NICE_ONLY)
  })

  it('leaves the oom score alone off linux', () => {
    expect(workloadPolicy({ env: POD_ENV, platform: 'darwin' })).toEqual(NICE_ONLY)
  })

  it('does nothing on windows', () => {
    expect(workloadPolicy({ env: POD_ENV, platform: 'win32' })).toEqual({
      nice: null,
      oomScoreAdj: null,
    })
  })
})

describe('preludeScript', () => {
  it('is null when nothing is to be applied', () => {
    expect(preludeScript({ policy: { nice: null, oomScoreAdj: null } })).toBeNull()
  })

  it('writes the oom score before the nice step and always ends in an exec of the command', () => {
    const script = preludeScript({ policy: BOTH }) ?? ''
    expect(script.indexOf('/proc/self/oom_score_adj')).toBeLessThan(script.indexOf('nice -n'))
    expect(script).toContain('echo 800 > /proc/self/oom_score_adj')
    expect(script.trimEnd().endsWith('exec "$@"')).toBe(true)
  })

  it('omits the oom write when the policy has none', () => {
    expect(preludeScript({ policy: NICE_ONLY })).not.toContain('oom_score_adj')
  })

  it('refuses a non-integer value rather than interpolating it into shell', () => {
    expect(preludeScript({ policy: { nice: 0, oomScoreAdj: Number.NaN } })).toBeNull()
    expect(preludeScript({ policy: { nice: 1.5, oomScoreAdj: null } })).toBeNull()
  })
})

describe('demotedCommand', () => {
  it('passes the original argv through as positional parameters', () => {
    const cmd = ['bash', '-c', "echo 'a b'; exit 3"]
    const wrapped = demotedCommand({ cmd, policy: BOTH })
    expect(wrapped.slice(0, 2)).toEqual(['/bin/sh', '-c'])
    expect(wrapped.slice(3)).toEqual(['sh', ...cmd])
  })

  it('leaves the command unwrapped when the policy is empty', () => {
    const cmd = ['bash', '-c', 'true']
    expect(demotedCommand({ cmd, policy: { nice: null, oomScoreAdj: null } })).toEqual(cmd)
  })

  it('leaves an unresolvable executable unwrapped so the spawn error is unchanged', () => {
    const cmd = ['definitely-not-a-real-binary-xyz', '--flag']
    expect(demotedCommand({ cmd, policy: BOTH })).toEqual(cmd)
  })

  it('leaves an empty command alone', () => {
    expect(demotedCommand({ cmd: [], policy: BOTH })).toEqual([])
  })
})
