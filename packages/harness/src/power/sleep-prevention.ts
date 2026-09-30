import { spawn, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { LogPort } from '@dltech/atlas-core'

export type SleepPreventionDeps = {
  platform?: NodeJS.Platform
  pid?: number
  log?: LogPort | undefined
  spawnCaffeinate?: (args: { pid: number }) => PowerAssertionHandle | undefined
  powerSource?: () => Promise<PowerSource>
}

export type PowerSource = 'ac' | 'battery'

export type PowerAssertionHandle = {
  stop: () => void
}

const onBattery = (report: string): boolean => report.includes("'Battery Power'")

const probePowerSource = async (): Promise<PowerSource> => {
  const report = await promisify(execFile)('pmset', ['-g', 'batt'])
    .then(({ stdout }) => stdout)
    .catch(() => undefined)
  if (report === undefined || onBattery(report)) return 'battery'
  return 'ac'
}

const spawnCaffeinateAssertion = ({ pid }: { pid: number }): PowerAssertionHandle | undefined => {
  try {
    // `-w <pid>` ties the assertion to this process's lifetime, so it dies with us even on
    // SIGKILL and needs no TTL or respawn; `-i` blocks idle sleep only, so lid close still sleeps.
    const child: ChildProcess = spawn('caffeinate', ['-i', '-w', String(pid)], { stdio: 'ignore' })
    child.unref()
    let stopped = false
    child.on('error', () => {
      stopped = true
    })
    return {
      stop: () => {
        if (stopped) return
        stopped = true
        child.kill()
      },
    }
  } catch {
    return undefined
  }
}

/**
 * Refcounted idle-sleep prevention: while any turn, background shell, or child agent holds a
 * lease, one caffeinate assertion keeps a Mac on AC power from idling to sleep mid-turn.
 */
export class SleepPrevention {
  private readonly platform: NodeJS.Platform
  private readonly pid: number
  private readonly log: LogPort | undefined
  private readonly spawnAssertion: (args: { pid: number }) => PowerAssertionHandle | undefined
  private readonly powerSource: () => Promise<PowerSource>
  private holders = 0
  private assertion: PowerAssertionHandle | undefined
  private asserting: Promise<void> | undefined

  constructor(deps: SleepPreventionDeps = {}) {
    this.platform = deps.platform ?? process.platform
    this.pid = deps.pid ?? process.pid
    this.log = deps.log
    this.spawnAssertion = deps.spawnCaffeinate ?? spawnCaffeinateAssertion
    this.powerSource = deps.powerSource ?? probePowerSource
  }

  acquire(): () => void {
    this.holders += 1
    if (this.holders === 1) void this.assert()
    let held = true
    return () => {
      if (!held) return
      held = false
      this.release()
    }
  }

  private release(): void {
    if (this.holders === 0) return
    this.holders -= 1
    if (this.holders > 0) return
    void this.settle()
  }

  private async settle(): Promise<void> {
    await this.asserting
    if (this.holders > 0) return
    this.assertion?.stop()
    this.assertion = undefined
  }

  private assert(): Promise<void> {
    this.asserting ??= this.assertOnce().finally(() => {
      this.asserting = undefined
    })
    return this.asserting
  }

  private async assertOnce(): Promise<void> {
    if (this.platform !== 'darwin') return
    if ((await this.powerSource()) !== 'ac') return
    if (this.holders === 0 || this.assertion !== undefined) return
    this.assertion = this.spawnAssertion({ pid: this.pid })
    if (this.assertion === undefined) return
    this.log?.info({
      source: 'power.sleep-prevention',
      message: 'holding a caffeinate assertion against idle sleep while work is in flight',
    })
  }
}
