import { describe, expect, test } from 'bun:test'

import { cgroupCpuUsecOf, readCgroupCpuUsec } from '../cgroup-cpu'

const V2_STAT = ['usage_usec 4212000', 'user_usec 3000000', 'system_usec 1212000'].join('\n')

describe('cgroupCpuUsecOf', () => {
  test('reads cumulative usage from a v2 cpu.stat', () => {
    expect(cgroupCpuUsecOf({ stat: V2_STAT, acctUsage: '999' })).toBe(4_212_000)
  })

  test('falls back to a v1 cpuacct.usage in nanoseconds', () => {
    expect(cgroupCpuUsecOf({ stat: undefined, acctUsage: '4212000000\n' })).toBe(4_212_000)
  })

  test('a v2 stat without usage_usec still falls back to v1', () => {
    expect(cgroupCpuUsecOf({ stat: 'nr_periods 0', acctUsage: '7000' })).toBe(7)
  })

  test('neither file reads as unknown rather than zero', () => {
    expect(cgroupCpuUsecOf({ stat: undefined, acctUsage: undefined })).toBeUndefined()
    expect(cgroupCpuUsecOf({ stat: 'nr_periods 0', acctUsage: 'nonsense' })).toBeUndefined()
  })
})

describe('readCgroupCpuUsec', () => {
  test('reads ./cpu.stat under the given root', () => {
    const files = new Map<string, string>([['/box/cpu.stat', V2_STAT]])
    const usec = readCgroupCpuUsec({ root: '/box', read: (path) => files.get(path) })
    expect(usec).toBe(4_212_000)
  })

  test('a host with neither cgroup layout reports nothing', () => {
    expect(readCgroupCpuUsec({ root: '/box', read: () => undefined })).toBeUndefined()
  })
})
