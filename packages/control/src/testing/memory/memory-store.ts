import type { SessionChange } from '@dltech/atlas-protocol'

import type { ChangeFeed } from '../../change-feed'
import {
  ControlStorePort,
  type ControlTx,
  type InsertRoutineRunParams,
  type ListDueRoutinesParams,
  type ListRoutineRunsParams,
  type ListRoutinesParams,
  type ReadRoutineForUserParams,
  type PrStateRow,
  type RoutineRow,
  type RoutineRunRow,
  type SubscriptionLease,
  type TrackingTarget,
} from '../../port'
import type {
  ControlTerminalRow,
  CreateTerminalParams,
  EndTerminalParams,
  TerminalEndedReason,
} from '../../terminal-rows'
import { dueRoutinesIn, routineRunsIn, userRoutineIn, userRoutinesIn } from './memory-routines'
import { MemoryTx } from './memory-tx'
import { MemoryTestControls } from './memory-test-controls'
import { cloneState, emptyState, type State } from './memory-state'

export class InMemoryControlStore extends ControlStorePort implements ChangeFeed {
  private readonly clock: () => string
  private state: State = emptyState()
  private tail: Promise<unknown> = Promise.resolve()
  private readonly controls = new MemoryTestControls(() => this.state)
  private terminals: ControlTerminalRow[] = []

  constructor(params: { clock?: (() => string) | undefined } = {}) {
    super()
    this.clock = params.clock ?? (() => new Date().toISOString())
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const working = cloneState(this.state)
      const pending: SessionChange[] = []
      const result = await work(
        new MemoryTx({
          state: working,
          clock: this.clock,
          presentHosts: this.controls.presentHosts,
          pending,
        }),
      )
      this.state = working
      this.controls.feed.publish(pending)
      return result
    }
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }

  listDueRoutines(params: ListDueRoutinesParams): Promise<RoutineRow[]> {
    return Promise.resolve(dueRoutinesIn({ state: this.state, ...params }))
  }

  listRoutines(params: ListRoutinesParams): Promise<RoutineRow[]> {
    return Promise.resolve(userRoutinesIn({ state: this.state, ...params }))
  }

  readRoutineForUser(params: ReadRoutineForUserParams): Promise<RoutineRow | undefined> {
    return Promise.resolve(userRoutineIn({ state: this.state, ...params }))
  }

  listRoutineRuns(params: ListRoutineRunsParams): Promise<RoutineRunRow[]> {
    return Promise.resolve(routineRunsIn({ state: this.state, ...params }))
  }

  nextHostId(): number {
    return this.controls.nextHostId()
  }

  markHostPresent(hostId: number): void {
    this.controls.presentHosts.add(hostId)
  }

  markHostAbsent(hostId: number): void {
    this.controls.presentHosts.delete(hostId)
  }

  wakeCount(sessionId: string): number {
    return this.controls.wakeCount(sessionId)
  }

  onChange(listener: (change: SessionChange) => void): () => void {
    return this.controls.onChange(listener)
  }

  onGap(listener: () => void): () => void {
    return this.controls.onGap(listener)
  }

  setPrState(row: PrStateRow): void {
    this.controls.setPrState(row)
  }

  softDeleteSession(sessionId: string): void {
    this.controls.setSessionDeleted(sessionId)
  }

  subscriptionLeases(): Array<SubscriptionLease & { expiresAt: string }> {
    return this.controls.subscriptionLeases()
  }

  trackingTargets(): TrackingTarget[] {
    return this.controls.trackingTargets()
  }

  setRoutine(row: RoutineRow): void {
    this.controls.setRoutine(row)
  }

  routineRuns(routineId: string): InsertRoutineRunParams[] {
    return this.controls.routineRuns(routineId)
  }

  changesOf(sessionId: string): SessionChange[] {
    return this.controls.changesOf(sessionId)
  }

  private terminalRowsOf(sessionId: string): ControlTerminalRow[] {
    return this.terminals
      .filter((row) => row.sessionId === sessionId)
      .sort((left, right) => left.ordinal - right.ordinal)
  }

  async listTerminals(params: { sessionId: string }): Promise<ControlTerminalRow[]> {
    return this.terminalRowsOf(params.sessionId)
  }

  async readTerminal(params: {
    sessionId: string
    terminalId: string
  }): Promise<ControlTerminalRow | undefined> {
    return this.terminals.find(
      (row) => row.sessionId === params.sessionId && row.terminalId === params.terminalId,
    )
  }

  async createTerminal(params: CreateTerminalParams): Promise<ControlTerminalRow | undefined> {
    const rows = this.terminalRowsOf(params.sessionId)
    if (rows.filter((row) => row.state !== 'ended').length >= params.limit) return undefined
    const ordinal = rows.reduce((max, row) => Math.max(max, row.ordinal), 0) + 1
    const row: ControlTerminalRow = {
      sessionId: params.sessionId,
      terminalId: params.terminalId,
      ordinal,
      name: `Terminal ${ordinal}`,
      state: 'opening',
      exitCode: null,
      signal: null,
      endedReason: null,
      createdAt: this.clock(),
      endedAt: null,
    }
    this.terminals.push(row)
    return { ...row }
  }

  async renameTerminal(params: {
    sessionId: string
    terminalId: string
    name: string
  }): Promise<ControlTerminalRow | undefined> {
    const row = await this.readTerminal(params)
    if (row === undefined) return undefined
    row.name = params.name
    return { ...row }
  }

  async markTerminalOpen(params: { sessionId: string; terminalId: string }): Promise<void> {
    const row = await this.readTerminal(params)
    if (row === undefined || row.state !== 'opening') return
    row.state = 'open'
  }

  async endTerminal(params: EndTerminalParams): Promise<ControlTerminalRow | undefined> {
    const row = await this.readTerminal(params)
    if (row === undefined || row.state === 'ended') return undefined
    row.state = 'ended'
    row.endedReason = params.reason
    row.exitCode = params.exitCode ?? null
    row.signal = params.signal ?? null
    row.endedAt = this.clock()
    return { ...row }
  }

  async endTerminals(params: { sessionId: string; reason: TerminalEndedReason }): Promise<number> {
    const open = this.terminalRowsOf(params.sessionId).filter((row) => row.state === 'open')
    for (const row of open) {
      row.state = 'ended'
      row.endedReason = params.reason
      row.endedAt = this.clock()
    }
    return open.length
  }

  async deleteTerminal(params: { sessionId: string; terminalId: string }): Promise<void> {
    this.terminals = this.terminals.filter(
      (row) => row.sessionId !== params.sessionId || row.terminalId !== params.terminalId,
    )
  }
}
