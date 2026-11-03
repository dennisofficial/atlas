import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DAEMON_OOM_SCORE_ADJ, SANDBOX_WORKLOADS_ENV } from '@dltech/atlas-wire'

import { sandboxIsolatedEnv } from '../environment'
import { applyServePriority } from '../serve-priority'
import { WORK_PIDS_MAX, pidsMaxFor, prepareWorkloadCgroups } from '../workload-cgroups'
import { WORKLOAD_OOM_SCORE_ADJ, workloadPolicy } from '../workload-priority'

const SANDBOX_ENV = { [SANDBOX_WORKLOADS_ENV]: '1' }

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

describe('sandboxIsolatedEnv', () => {
  it('is empty without a cgroup split or off linux', () => {
    expect(sandboxIsolatedEnv({ env: {}, platform: 'linux' })).toEqual({})
    expect(
      sandboxIsolatedEnv({ env: { ATLAS_WORKLOAD_CGROUP: '/cg/atlas-work' }, platform: 'darwin' }),
    ).toEqual({})
  })

  it('carries the split, the isolation marker and the daemon oom score on linux', () => {
    const env = sandboxIsolatedEnv({
      env: { ATLAS_WORKLOAD_CGROUP: '/cg/atlas-work' },
      platform: 'linux',
    })
    expect(env).toEqual({
      [SANDBOX_WORKLOADS_ENV]: '1',
      ATLAS_WORKLOAD_CGROUP: '/cg/atlas-work',
      ATLAS_WORKLOAD_PIDS_MAX: String(WORK_PIDS_MAX),
      [DAEMON_OOM_SCORE_ADJ]: '-900',
    })
  })
})

describe('pidsMaxFor', () => {
  it('defaults to the workload cap and honours a valid override', () => {
    expect(pidsMaxFor({})).toBe(WORK_PIDS_MAX)
    expect(pidsMaxFor({ ATLAS_WORKLOAD_PIDS_MAX: '128' })).toBe(128)
    expect(pidsMaxFor({ ATLAS_WORKLOAD_PIDS_MAX: 'nope' })).toBe(WORK_PIDS_MAX)
    expect(pidsMaxFor({ ATLAS_WORKLOAD_PIDS_MAX: '0' })).toBe(WORK_PIDS_MAX)
  })
})

describe('prepareWorkloadCgroups under the sandbox marker', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cgroup-sandbox-'))
    writeFileSync(join(root, 'cgroup.procs'), '')
    writeFileSync(join(root, 'cgroup.subtree_control'), '')
    delete process.env.ATLAS_WORKLOAD_CGROUP
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    delete process.env.ATLAS_WORKLOAD_CGROUP
  })

  it('is enabled with the marker and honours the pids override', () => {
    const report = prepareWorkloadCgroups({
      env: { ...SANDBOX_ENV, ATLAS_WORKLOAD_PIDS_MAX: '64' },
      platform: 'linux',
      root,
      meminfo: 'MemTotal:       4194304 kB\n',
    })
    expect(report.enabled && report.ok && report.limits.pidsMax).toBe(64)
    expect(readFileSync(join(root, 'atlas-work', 'pids.max'), 'utf8')).toBe('64')
    expect(existsSync(join(root, 'atlas-serve'))).toBe(true)
    expect(process.env.ATLAS_WORKLOAD_CGROUP).toBe(join(root, 'atlas-work'))
  })
})

describe('applyServePriority as the daemon', () => {
  it('applies only the configured oom score under the sandbox marker', () => {
    const { calls, deps } = recordingDeps()
    const report = applyServePriority({
      env: { ...SANDBOX_ENV, [DAEMON_OOM_SCORE_ADJ]: '-900' },
      platform: 'linux',
      deps,
    })
    expect(report).toEqual({
      enabled: true,
      oomScoreAdj: { applied: true },
      nice: { applied: false, error: 'nice skipped below zero' },
    })
    expect(calls).toEqual({ oom: [-900], nice: [] })
  })

  it('is disabled under the marker with no oom score configured', () => {
    const { calls, deps } = recordingDeps()
    expect(applyServePriority({ env: SANDBOX_ENV, platform: 'linux', deps })).toEqual({
      enabled: false,
    })
    expect(calls).toEqual({ oom: [], nice: [] })
  })
})

describe('workloadPolicy under the sandbox marker', () => {
  it('demotes workloads the same way an api-provisioned pod does', () => {
    expect(workloadPolicy({ env: SANDBOX_ENV, platform: 'linux' })).toEqual({
      nice: 10,
      oomScoreAdj: WORKLOAD_OOM_SCORE_ADJ,
      cgroup: null,
    })
    const boxed = { ...SANDBOX_ENV, ATLAS_WORKLOAD_CGROUP: '/cg/atlas-work' }
    expect(workloadPolicy({ env: boxed, platform: 'linux' }).cgroup).toBe('/cg/atlas-work')
  })
})
