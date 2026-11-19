import type { ControlPlane } from '@dltech/atlas-control'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { HeldWaits } from './held-waits'
import { PANEL_HOLD_TTL_MS, PanelDemand } from './panel-demand'
import type { HostBus, HostTimers } from './ports'
import { TerminalDemand } from './terminal-demand'

const requestHolderFor = async (args: {
  plane: ControlPlane
  holds(sessionId: string): boolean
  sessionId: string
}): Promise<boolean> => {
  if (args.holds(args.sessionId)) return true
  const current = await args.plane.currentLease({ sessionId: args.sessionId })
  if (current.lease.holderHostId !== null && current.live) return false
  if (current.lease.wantsHolder) {
    await args.plane.wake({ sessionIds: [args.sessionId] })
    return true
  }
  await args.plane.revoke({ sessionId: args.sessionId, wantsHolder: true })
  return true
}

export class HolderDemand {
  readonly terminal: TerminalDemand
  readonly panel: PanelDemand
  private readonly waits: HeldWaits
  private readonly unsubPanelHold: () => void
  private readonly args: {
    plane: ControlPlane
    bus: HostBus
    timers: HostTimers
    holds(sessionId: string): boolean
    draining(): boolean
    onReconcile(sessionId: string): void
    terminal: TerminalDemand | undefined
    panel: PanelDemand | undefined
    log: LogPort | undefined
  }

  constructor(args: HolderDemand['args']) {
    this.args = args
    this.waits = new HeldWaits(args.timers)
    this.terminal = args.terminal ?? new TerminalDemand()
    this.terminal.observe({
      onWork: (sessionId) => {
        void this.requestHolder(sessionId).catch((error: unknown) => this.logFault(error))
      },
      onIdle: (sessionId) => this.requestReconcile(sessionId),
    })
    this.panel = args.panel ?? new PanelDemand()
    this.panel.observe({
      onWork: (sessionId) => {
        void this.requestHolder(sessionId).catch((error: unknown) => this.logFault(error))
      },
      onIdle: (sessionId) => this.requestReconcile(sessionId),
    })
    this.unsubPanelHold = args.bus.onPanelHold((hold) => this.panel.hold(hold))
  }

  holdPanel(args: { sessionId: string; ttlMs?: number | undefined }): boolean {
    const ttlMs = args.ttlMs ?? PANEL_HOLD_TTL_MS
    this.panel.hold({ sessionId: args.sessionId, ttlMs })
    this.args.bus
      .panelHold({ sessionId: args.sessionId, ttlMs })
      .catch((error: unknown) => this.logFault(error))
    return true
  }

  stop(): void {
    this.unsubPanelHold()
  }

  notifyHeld(sessionId: string): void {
    this.waits.notify(sessionId)
  }

  requestHolder(sessionId: string): Promise<boolean> {
    if (this.args.draining()) return Promise.resolve(false)
    return requestHolderFor({
      plane: this.args.plane,
      holds: this.args.holds,
      sessionId,
    })
  }

  async ensureHeld(args: {
    sessionId: string
    timeoutMs: number
    signal?: AbortSignal | undefined
  }): Promise<boolean> {
    if (this.args.holds(args.sessionId)) return true
    const wait = this.waits.wait(args)
    if (!(await this.requestHolder(args.sessionId).catch(() => false))) {
      wait.cancel()
      return false
    }
    return wait.done
  }

  requestReconcile(sessionId: string): void {
    this.args.onReconcile(sessionId)
  }

  private logFault(error: unknown): void {
    this.args.log?.warn({
      source: 'holder.demand',
      message: 'asking the control plane for a holder failed',
      ...logFieldsOf({ error }),
    })
  }
}
