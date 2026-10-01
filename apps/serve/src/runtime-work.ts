import { EAgentStatus, EServiceStatus, EShellStatus } from '@dltech/atlas-core'

import type { ServeApp } from './serve-app'
import type { ServeTurnDriver } from './turn-driver'

export type RuntimeWork = {
  turnRunning: boolean
  busy: boolean
  childrenRunning: number
  shellsRunning: number
  servicesRunning: number
  pendingInput: boolean
  settlingWork: boolean
}

export function runtimeWork(args: {
  app: ServeApp
  driver: ServeTurnDriver
  settling: number
}): RuntimeWork {
  const { app, driver } = args
  const roster = app.roster?.snapshot()
  return {
    turnRunning: driver.running(),
    busy: driver.busy(),
    childrenRunning: app.runningChildren?.() ?? roster?.agents.filter((child) => child.status === EAgentStatus.Running).length ?? 0,
    shellsRunning: app.runningShells?.() ?? roster?.shells.filter((shell) => shell.status === EShellStatus.Running).length ?? 0,
    servicesRunning: app.runningServices?.() ?? roster?.services.filter((service) => service.status === EServiceStatus.Running).length ?? 0,
    pendingInput: app.pendingInput?.() ?? ((app.intake?.threadsWithPendingInput().length ?? 0) > 0 || (app.pending?.waitingCount() ?? 0) > 0),
    settlingWork: args.settling > 0 || (app.settlingWork?.() ?? false) || (app.intake?.busy() ?? false),
  }
}

export function runtimeHasWork(work: RuntimeWork): boolean {
  return work.busy || work.childrenRunning > 0 || work.shellsRunning > 0 || work.servicesRunning > 0 || work.pendingInput || work.settlingWork
}
