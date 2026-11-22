import { describe, expect, test } from 'bun:test'

import { daemonCpuUsecFromAnswer } from '../daemon-cpu'

describe('daemonCpuUsecFromAnswer', () => {
  test('reads the daemon reading', () => {
    expect(daemonCpuUsecFromAnswer('{"usageUsec":4212000}')).toBe(4_212_000)
  })

  test('a daemon that cannot see a cgroup answers null, which reads as unmeasured', () => {
    expect(daemonCpuUsecFromAnswer('{"usageUsec":null}')).toBeUndefined()
  })

  test('a forbidden or empty answer reads as unmeasured', () => {
    expect(daemonCpuUsecFromAnswer('forbidden')).toBeUndefined()
    expect(daemonCpuUsecFromAnswer('')).toBeUndefined()
  })

  test('a fractional reading floors to whole microseconds', () => {
    expect(daemonCpuUsecFromAnswer('{"usageUsec":4212000.7}')).toBe(4_212_000)
  })
})
