import { describe, expect, it } from 'bun:test'

import {
  WORKLOAD_NICE,
  WORKLOAD_OOM_SCORE_ADJ,
  demotedCommand,
  preludeScript,
  workloadPolicy,
} from '../workload-priority'

const POD_ENV = { ATLAS_API_PROVISIONED: '1' }
const NICE_ONLY = { nice: WORKLOAD_NICE, oomScoreAdj: null, cgroup: null }
const BOTH = { nice: WORKLOAD_NICE, oomScoreAdj: WORKLOAD_OOM_SCORE_ADJ, cgroup: null }
const WORK = '/sys/fs/cgroup/atlas-work'
const BOXED = { ...BOTH, cgroup: WORK }

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
      cgroup: null,
    })
  })

  it('learns the cgroup split from the env on linux only', () => {
    const env = { ...POD_ENV, ATLAS_WORKLOAD_CGROUP: WORK }
    expect(workloadPolicy({ env, platform: 'linux' }).cgroup).toBe(WORK)
    expect(workloadPolicy({ env, platform: 'darwin' }).cgroup).toBeNull()
    expect(workloadPolicy({ env: POD_ENV, platform: 'linux' }).cgroup).toBeNull()
  })
})

describe('preludeScript', () => {
  it('is null when nothing is to be applied', () => {
    expect(preludeScript({ policy: { nice: null, oomScoreAdj: null, cgroup: null } })).toBeNull()
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
    expect(preludeScript({ policy: { nice: 0, oomScoreAdj: Number.NaN, cgroup: null } })).toBeNull()
    expect(preludeScript({ policy: { nice: 1.5, oomScoreAdj: null, cgroup: null } })).toBeNull()
  })
})

describe('preludeScript with a cgroup', () => {
  it('joins its own box first, before the oom and nice steps', () => {
    const script = preludeScript({ policy: BOXED }) ?? ''
    expect(
      script.startsWith(
        `{ b=${WORK}/w-$$; mkdir "$b" && echo 1 > "$b/memory.oom.group"; echo $$ > "$b/cgroup.procs"; } 2>/dev/null`,
      ),
    ).toBe(true)
    expect(script.indexOf('cgroup.procs')).toBeLessThan(script.indexOf('oom_score_adj'))
    expect(script.indexOf('cgroup.procs')).toBeLessThan(script.indexOf('nice -n'))
    expect(script.trimEnd().endsWith('exec "$@"')).toBe(true)
  })

  it('works when it is the only step', () => {
    const script = preludeScript({ policy: { nice: null, oomScoreAdj: null, cgroup: WORK } })
    expect(script).toContain('cgroup.procs')
  })

  it('refuses a path that could carry shell syntax', () => {
    for (const cgroup of ['/a b', '/a;rm -rf /', 'relative/path', '/a$(x)', "/a'b", '']) {
      expect(preludeScript({ policy: { ...BOTH, cgroup } })).toBeNull()
    }
  })

  it('is unchanged when the cgroup is null', () => {
    expect(preludeScript({ policy: BOTH })).not.toContain('cgroup')
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
    expect(
      demotedCommand({ cmd, policy: { nice: null, oomScoreAdj: null, cgroup: null } }),
    ).toEqual(cmd)
  })

  it('leaves an unresolvable executable unwrapped so the spawn error is unchanged', () => {
    const cmd = ['definitely-not-a-real-binary-xyz', '--flag']
    expect(demotedCommand({ cmd, policy: BOTH })).toEqual(cmd)
  })

  it('leaves an empty command alone', () => {
    expect(demotedCommand({ cmd: [], policy: BOTH })).toEqual([])
  })
})
