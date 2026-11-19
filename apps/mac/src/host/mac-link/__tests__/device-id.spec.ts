import { describe, expect, test } from 'bun:test'

import { createDeviceId } from '../device-id'

const store = () => {
  let value: string | undefined
  const writes: string[] = []
  return {
    read: () => value,
    write: (next: string) => {
      value = next
      writes.push(next)
    },
    writes,
  }
}

describe('createDeviceId', () => {
  test('generates an id once, writes it once and returns the same id after', () => {
    const fake = store()
    const deviceId = createDeviceId({ read: fake.read, write: fake.write })

    const first = deviceId()
    const second = deviceId()

    expect(first.length).toBeGreaterThan(0)
    expect(second).toBe(first)
    expect(fake.writes).toEqual([first])
  })

  test('reuses the id already in the store', () => {
    const fake = store()
    const deviceId = createDeviceId({ read: () => 'stored-id', write: fake.write })

    expect(deviceId()).toBe('stored-id')
    expect(fake.writes).toEqual([])
  })
})
