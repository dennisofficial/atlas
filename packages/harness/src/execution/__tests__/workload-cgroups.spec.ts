import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  killWorkloadBox,
  prepareWorkloadCgroups,
  sweepIdleWorkloadBoxes,
} from '../workload-cgroups'

const POD_ENV = { ATLAS_API_PROVISIONED: '1' }
const GIB_KB = 1024 * 1024
const meminfoOf = (kb: number): string => `MemTotal:       ${kb} kB\nMemFree:  1 kB\n`

let root = ''
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8').trim()

const fakeRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cgroup-root-'))
  writeFileSync(join(dir, 'cgroup.controllers'), 'cpuset cpu io memory hugetlb pids\n')
  writeFileSync(join(dir, 'cgroup.procs'), '1\n2\n3\n')
  writeFileSync(join(dir, 'cgroup.subtree_control'), '')
  return dir
}

beforeEach(() => {
  root = fakeRoot()
  delete process.env.ATLAS_WORKLOAD_CGROUP
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.ATLAS_WORKLOAD_CGROUP
})

describe('prepareWorkloadCgroups', () => {
  it('is disabled outside an api-provisioned pod and touches nothing', () => {
    const report = prepareWorkloadCgroups({ env: {}, platform: 'linux', root })
    expect(report).toEqual({ enabled: false })
    expect(existsSync(join(root, 'atlas-work'))).toBe(false)
    expect(process.env.ATLAS_WORKLOAD_CGROUP).toBeUndefined()
  })

  it('is disabled in a local docker pod and off linux', () => {
    const docker = { ...POD_ENV, ATLAS_POD_NAME: 'pod-1' }
    expect(prepareWorkloadCgroups({ env: docker, platform: 'linux', root })).toEqual({
      enabled: false,
    })
    expect(prepareWorkloadCgroups({ env: POD_ENV, platform: 'darwin', root })).toEqual({
      enabled: false,
    })
  })

  it('writes the controllers, limits and weights, sizing memory from meminfo', () => {
    const report = prepareWorkloadCgroups({
      env: POD_ENV,
      platform: 'linux',
      root,
      meminfo: meminfoOf(8 * GIB_KB),
    })

    expect(report).toEqual({
      enabled: true,
      ok: true,
      workGroup: join(root, 'atlas-work'),
      limits: {
        pidsMax: 16384,
        memoryMaxBytes: 6 * 1024 ** 3,
        memorySwapMax: 0,
        cpuWeight: 20,
        serveCpuWeight: 500,
      },
    })
    expect(read('cgroup.subtree_control')).toBe('+cpu +pids +memory')
    expect(read('atlas-work/cgroup.subtree_control')).toBe('+memory +pids')
    expect(read('atlas-work/pids.max')).toBe('16384')
    expect(read('atlas-work/memory.max')).toBe(String(6 * 1024 ** 3))
    expect(read('atlas-work/memory.swap.max')).toBe('0')
    expect(read('atlas-work/memory.oom.group')).toBe('0')
    expect(read('atlas-work/cpu.weight')).toBe('20')
    expect(read('atlas-serve/cpu.weight')).toBe('500')
    expect(['1', '2', '3']).toContain(read('atlas-serve/cgroup.procs'))
    expect(process.env.ATLAS_WORKLOAD_CGROUP).toBe(join(root, 'atlas-work'))
  })

  it('reserves 1.5 GiB on a small pod and a quarter on a large one', () => {
    const memoryMax = (totalGib: number): number => {
      const report = prepareWorkloadCgroups({
        env: POD_ENV,
        platform: 'linux',
        root,
        meminfo: meminfoOf(totalGib * GIB_KB),
      })
      return report.enabled && report.ok ? report.limits.memoryMaxBytes : -1
    }
    expect(memoryMax(4)).toBe(2.5 * 1024 ** 3)
    expect(memoryMax(16)).toBe(12 * 1024 ** 3)
  })

  it('is idempotent on a prepared tree', () => {
    const args = {
      env: POD_ENV,
      platform: 'linux' as const,
      root,
      meminfo: meminfoOf(8 * GIB_KB),
    }
    const first = prepareWorkloadCgroups(args)
    const second = prepareWorkloadCgroups(args)
    expect(second).toEqual(first)
    expect(read('atlas-work/pids.max')).toBe('16384')
  })

  it('reports the failing step without throwing and leaves the env var unset', () => {
    rmSync(join(root, 'cgroup.subtree_control'))
    mkdirSync(join(root, 'cgroup.subtree_control'))

    const report = prepareWorkloadCgroups({
      env: POD_ENV,
      platform: 'linux',
      root,
      meminfo: meminfoOf(8 * GIB_KB),
    })

    expect(report.enabled && !report.ok && report.step).toBe('enable-root-controllers')
    expect(report.enabled && !report.ok && report.error.length).toBeGreaterThan(0)
    expect(process.env.ATLAS_WORKLOAD_CGROUP).toBeUndefined()
  })

  it('reports an unreadable meminfo as a failed step', () => {
    const report = prepareWorkloadCgroups({
      env: POD_ENV,
      platform: 'linux',
      root,
      meminfo: 'nothing useful',
    })
    expect(report.enabled && !report.ok && report.step).toBe('size-memory')
  })
})

describe('sweepIdleWorkloadBoxes', () => {
  const box = (name: string, ageMs: number, now: number): string => {
    const dir = join(root, 'atlas-work', name)
    mkdirSync(dir, { recursive: true })
    const at = new Date(now - ageMs)
    utimesSync(dir, at, at)
    return dir
  }

  it('removes old empty boxes, keeps young ones and non-box entries', () => {
    const now = Date.now()
    const old = box('w-100', 60_000, now)
    const young = box('w-101', 1_000, now)
    const other = box('keep-me', 60_000, now)

    sweepIdleWorkloadBoxes({ root, now })

    expect(existsSync(old)).toBe(false)
    expect(existsSync(young)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })

  it('ignores a box that cannot be removed', () => {
    const now = Date.now()
    const busy = box('w-102', 60_000, now)
    writeFileSync(join(busy, 'cgroup.procs'), '5\n')

    expect(() => sweepIdleWorkloadBoxes({ root, now })).not.toThrow()
    expect(existsSync(busy)).toBe(true)
  })

  it('does nothing when atlas-work does not exist', () => {
    expect(() => sweepIdleWorkloadBoxes({ root })).not.toThrow()
  })
})

describe('killWorkloadBox', () => {
  it('writes 1 to the box cgroup.kill when the split exists', () => {
    const dir = join(root, 'atlas-work', 'w-42')
    mkdirSync(dir, { recursive: true })

    killWorkloadBox({ pid: 42, env: { ATLAS_WORKLOAD_CGROUP: join(root, 'atlas-work') } })

    expect(readFileSync(join(dir, 'cgroup.kill'), 'utf8')).toBe('1')
  })

  it('does nothing without the split and swallows write errors', () => {
    expect(() => killWorkloadBox({ pid: 42, env: {} })).not.toThrow()
    expect(() =>
      killWorkloadBox({ pid: 42, env: { ATLAS_WORKLOAD_CGROUP: join(root, 'missing') } }),
    ).not.toThrow()
    expect(existsSync(join(root, 'atlas-work'))).toBe(false)
  })
})
