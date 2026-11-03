import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DAEMON_OOM_SCORE_ADJ, applyDaemonProtection } from '../daemon-protection'
import { SANDBOX_WORKLOADS_ENV } from '../markers'
import { WORK_PIDS_MAX, pidsMaxFor, prepareWorkloadCgroups } from '../workload-cgroups'
import { WORKLOAD_OOM_SCORE_ADJ, workloadPolicy } from '../workload-priority'

const SANDBOX_ENV = { [SANDBOX_WORKLOADS_ENV]: '1' }
const MEMINFO = 'MemTotal:       4194304 kB\n'

describe('pidsMaxFor', () => {
  it('defaults to the workload cap and honours a valid override', () => {
    expect(pidsMaxFor({})).toBe(WORK_PIDS_MAX)
    expect(pidsMaxFor({ ATLAS_WORKLOAD_PIDS_MAX: '128' })).toBe(128)
    expect(pidsMaxFor({ ATLAS_WORKLOAD_PIDS_MAX: 'nope' })).toBe(WORK_PIDS_MAX)
    expect(pidsMaxFor({ ATLAS_WORKLOAD_PIDS_MAX: '0' })).toBe(WORK_PIDS_MAX)
  })
})

describe('applyDaemonProtection', () => {
  let root = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cgroup-daemon-'))
    writeFileSync(join(root, 'cgroup.procs'), '')
    writeFileSync(join(root, 'cgroup.subtree_control'), '')
    delete process.env.ATLAS_WORKLOAD_CGROUP
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    delete process.env.ATLAS_WORKLOAD_CGROUP
  })

  it('builds the cgroup split and lowers its oom score with nothing asked for in env', () => {
    const env: Record<string, string | undefined> = { ATLAS_WORKLOAD_PIDS_MAX: '64' }
    const written: number[] = []
    const report = applyDaemonProtection({
      env,
      platform: 'linux',
      root,
      meminfo: MEMINFO,
      writeOomScoreAdj: (value) => void written.push(value),
    })
    expect(report.enabled && report.cgroups.enabled && report.cgroups.ok).toBe(true)
    expect(report.enabled && report.oomScoreAdj).toEqual({ applied: true })
    expect(written).toEqual([DAEMON_OOM_SCORE_ADJ])
    expect(env[SANDBOX_WORKLOADS_ENV]).toBe('1')
    expect(readFileSync(join(root, 'atlas-work', 'pids.max'), 'utf8')).toBe('64')
    expect(existsSync(join(root, 'atlas-serve'))).toBe(true)
    expect(process.env.ATLAS_WORKLOAD_CGROUP).toBe(join(root, 'atlas-work'))
  })

  it('reports a refused oom write and a missing cgroup root instead of throwing', () => {
    const report = applyDaemonProtection({
      env: {},
      platform: 'linux',
      root: join(root, 'missing'),
      meminfo: MEMINFO,
      writeOomScoreAdj: () => {
        throw new Error('EACCES')
      },
    })
    expect(report.enabled && report.oomScoreAdj).toEqual({ applied: false, error: 'EACCES' })
    expect(report.enabled && report.cgroups.enabled && !report.cgroups.ok).toBe(true)
  })

  it('ignores the pids override on the v1 pod path', () => {
    const report = prepareWorkloadCgroups({
      env: { ATLAS_API_PROVISIONED: '1', ATLAS_WORKLOAD_PIDS_MAX: '64' },
      platform: 'linux',
      root,
      meminfo: MEMINFO,
    })
    expect(report.enabled && report.ok && report.limits.pidsMax).toBe(WORK_PIDS_MAX)
  })

  it('does nothing off linux', () => {
    expect(applyDaemonProtection({ env: {}, platform: 'darwin' })).toEqual({ enabled: false })
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
