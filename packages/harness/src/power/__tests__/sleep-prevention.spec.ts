import { describe, expect, it } from 'bun:test'

import { SleepPrevention, type PowerAssertionHandle, type PowerSource } from '../sleep-prevention'

type Spawned = { pid: number; stopped: boolean }

function fixture({
  platform = 'darwin',
  source = 'ac',
  spawns,
}: {
  platform?: NodeJS.Platform
  source?: PowerSource
  spawns: Spawned[]
}): SleepPrevention {
  return new SleepPrevention({
    platform,
    pid: 4242,
    spawnCaffeinate: ({ pid }) => {
      const spawned: Spawned = { pid, stopped: false }
      spawns.push(spawned)
      const handle: PowerAssertionHandle = {
        stop: () => {
          spawned.stopped = true
        },
      }
      return handle
    },
    powerSource: () => Promise.resolve(source),
  })
}

const settled = () => Bun.sleep(0)

describe('SleepPrevention', () => {
  it('spawns one caffeinate on the 0→1 transition with the process pid', async () => {
    const spawns: Spawned[] = []
    const prevention = fixture({ spawns })

    const release = prevention.acquire()
    await settled()

    expect(spawns).toEqual([{ pid: 4242, stopped: false }])
    release()
  })

  it('holds one assertion across nested holders until the last release', async () => {
    const spawns: Spawned[] = []
    const prevention = fixture({ spawns })

    const first = prevention.acquire()
    const second = prevention.acquire()
    await settled()
    expect(spawns).toHaveLength(1)

    first()
    expect(spawns[0]?.stopped).toBe(false)
    second()
    await settled()
    expect(spawns[0]?.stopped).toBe(true)
  })

  it('re-asserts after the refcount returns to zero and climbs again', async () => {
    const spawns: Spawned[] = []
    const prevention = fixture({ spawns })

    const first = prevention.acquire()
    await settled()
    first()
    await settled()
    const release = prevention.acquire()
    await settled()

    expect(spawns).toHaveLength(2)
    expect(spawns[0]?.stopped).toBe(true)
    expect(spawns[1]?.stopped).toBe(false)
    release()
    await settled()
    expect(spawns[1]?.stopped).toBe(true)
  })

  it('never asserts on a non-darwin platform', async () => {
    const spawns: Spawned[] = []
    const prevention = fixture({ spawns, platform: 'linux' })

    prevention.acquire()
    await settled()

    expect(spawns).toHaveLength(0)
  })

  it('never asserts while the machine is on battery', async () => {
    const spawns: Spawned[] = []
    const prevention = fixture({ spawns, source: 'battery' })

    prevention.acquire()
    await settled()

    expect(spawns).toHaveLength(0)
  })

  it('treats a failed spawn as a silent no-op', async () => {
    const prevention = new SleepPrevention({
      platform: 'darwin',
      pid: 4242,
      spawnCaffeinate: () => undefined,
      powerSource: () => Promise.resolve('ac'),
    })

    prevention.acquire()()
    await settled()
  })

  it('does not spawn when every holder released before the power probe settled', async () => {
    const spawns: Spawned[] = []
    let answer: ((source: PowerSource) => void) | undefined
    const prevention = new SleepPrevention({
      platform: 'darwin',
      pid: 4242,
      spawnCaffeinate: ({ pid }) => {
        spawns.push({ pid, stopped: false })
        return { stop: () => undefined }
      },
      powerSource: () =>
        new Promise<PowerSource>((resolve) => {
          answer = resolve
        }),
    })

    prevention.acquire()()
    answer?.('ac')
    await settled()

    expect(spawns).toHaveLength(0)
  })

  it('spawns only once when a release and a re-acquire land inside the power probe', async () => {
    const spawns: Spawned[] = []
    let answer: ((source: PowerSource) => void) | undefined
    const prevention = new SleepPrevention({
      platform: 'darwin',
      pid: 4242,
      spawnCaffeinate: ({ pid }) => {
        const spawned: Spawned = { pid, stopped: false }
        spawns.push(spawned)
        return { stop: () => { spawned.stopped = true } }
      },
      powerSource: () =>
        new Promise<PowerSource>((resolve) => {
          answer = resolve
        }),
    })

    const first = prevention.acquire()
    first()
    const second = prevention.acquire()
    answer?.('ac')
    await settled()
    second()
    await settled()

    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.stopped).toBe(true)
  })

  it('keeps the assertion alive when a release function runs twice', async () => {
    const spawns: Spawned[] = []
    const prevention = fixture({ spawns })

    const first = prevention.acquire()
    const second = prevention.acquire()
    await settled()

    first()
    first()
    expect(spawns[0]?.stopped).toBe(false)
    second()
    await settled()
    expect(spawns[0]?.stopped).toBe(true)
  })
})
