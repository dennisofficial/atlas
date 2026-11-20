import { describe, expect, test } from 'bun:test'

import { daemonCpuReadingOf } from '../cpu'

describe('daemonCpuReadingOf', () => {
  test('reports the sandbox cgroup clock in microseconds', () => {
    const files = new Map<string, string>([['/box/cpu.stat', 'usage_usec 4212000\n']])
    const reading = daemonCpuReadingOf({ root: '/box', read: (path) => files.get(path) })
    expect(reading).toEqual({ usageUsec: 4_212_000 })
  })

  test('a host without a cgroup clock reads as null, not zero', () => {
    expect(daemonCpuReadingOf({ root: '/box', read: () => undefined })).toEqual({ usageUsec: null })
  })
})
