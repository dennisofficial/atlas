import { appendFileSync } from 'node:fs'

import type { ClockPort } from '@dltech/atlas-core'

import type { ServiceStartArgs, StartedServiceOutcome } from './service-registry-port'
import { ERestartVerdict, type ServiceSupervisor } from './service-supervisor'

export class ServiceRestarter {
  private readonly supervisor: ServiceSupervisor
  private readonly clock: ClockPort
  private readonly relaunch: (launch: ServiceStartArgs) => Promise<StartedServiceOutcome>
  private closed = false

  constructor(args: {
    supervisor: ServiceSupervisor
    clock: ClockPort
    relaunch: (launch: ServiceStartArgs) => Promise<StartedServiceOutcome>
  }) {
    this.supervisor = args.supervisor
    this.clock = args.clock
    this.relaunch = args.relaunch
  }

  close(): void {
    this.closed = true
    this.supervisor.suspend()
  }

  crashed({
    launch,
    name,
    logPath,
  }: {
    launch: ServiceStartArgs
    name: string
    logPath?: string
  }): void {
    if (this.closed) return

    const verdict = this.supervisor.recordCrash({ name, nowMs: Date.parse(this.clock.now()) })
    if (verdict === undefined) return

    if (verdict.verdict === ERestartVerdict.GiveUp) {
      this.noteCrashLoop({ name, crashes: verdict.crashes, logPath })
      return
    }

    this.supervisor.restartAfter({
      name,
      delayMs: verdict.delayMs,
      run: () => void this.restarted({ launch, name }),
    })
  }

  private async restarted({
    launch,
    name,
  }: {
    launch: ServiceStartArgs
    name: string
  }): Promise<void> {
    const outcome = await this.relaunch(launch)
    if (!outcome.ok) this.crashed({ launch, name })
  }

  private noteCrashLoop({
    name,
    crashes,
    logPath,
  }: {
    name: string
    crashes: number
    logPath?: string | undefined
  }): void {
    if (logPath === undefined) return
    try {
      appendFileSync(
        logPath,
        `\n[atlas] ${name} is crash-looping: ${crashes} crashes within 2 minutes, so it is not restarted again\n`,
      )
    } catch {
      return
    }
  }
}
