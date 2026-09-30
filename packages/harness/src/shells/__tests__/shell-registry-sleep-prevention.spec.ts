import { afterEach, describe, expect, it } from 'bun:test'

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EKilledBy, type ClockPort } from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { SleepPrevention } from '../../power/sleep-prevention'
import { BunShellRegistry } from '../shell-registry'
import { job, settle } from './shell-registry-fixture'

class FixedClock implements ClockPort {
  now(): string {
    return new Date().toISOString()
  }
}

function countingPrevention(): SleepPrevention & { held: number } {
  const counts = { held: 0 }
  const prevention = new SleepPrevention({ platform: 'linux' })
  prevention.acquire = () => {
    counts.held += 1
    return () => {
      counts.held -= 1
    }
  }
  Object.defineProperty(prevention, 'held', { get: () => counts.held })
  return prevention as SleepPrevention & { held: number }
}

const opened: { registry: BunShellRegistry; root: string }[] = []

const scratchHome = join(mkdtempSync(join(tmpdir(), 'atlas-power-')), '.atlas-home')
const previousAtlasHome = process.env.ATLAS_HOME
process.env.ATLAS_HOME = scratchHome

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.registry.closeAll()
    rmSync(entry.root, { recursive: true, force: true })
  }
})

function openWithPrevention(prevention: SleepPrevention): BunShellRegistry {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-shells-power-')))
  const registry = new BunShellRegistry(
    root,
    new FixedClock(),
    () => new HookChain({}),
    undefined,
    prevention,
  )
  opened.push({ registry, root })
  return registry
}

describe('a background shell holds a sleep assertion', () => {
  it('holds while the shell runs and releases when it exits', async () => {
    const prevention = countingPrevention()
    const registry = openWithPrevention(prevention)

    const started = registry.start(job({ command: 'printf done' }))
    if (!started.ok) throw new Error(`shell failed to start: ${started.reason}`)
    expect(prevention.held).toBe(1)

    await settle({ registry, shellId: started.snapshot.shellId })
    expect(prevention.held).toBe(0)
  })

  it('holds one lease per running shell', async () => {
    const prevention = countingPrevention()
    const registry = openWithPrevention(prevention)

    const first = registry.start(job({ command: 'sleep 30' }))
    const second = registry.start(job({ command: 'sleep 30' }))
    expect(first.ok && second.ok).toBe(true)
    expect(prevention.held).toBe(2)
  })

  it('releases when the shell is killed', async () => {
    const prevention = countingPrevention()
    const registry = openWithPrevention(prevention)

    const started = registry.start(job({ command: 'sleep 30' }))
    if (!started.ok) throw new Error(`shell failed to start: ${'reason' in started ? started.reason : JSON.stringify(started)}`)
    expect(prevention.held).toBe(1)

    const killed = registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.User,
      threadId: job({ command: '' }).threadId,
    })
    expect(killed.ok).toBe(true)

    for (let attempt = 0; attempt < 400 && prevention.held > 0; attempt += 1) {
      await Bun.sleep(25)
    }
    expect(prevention.held).toBe(0)
  })
})
