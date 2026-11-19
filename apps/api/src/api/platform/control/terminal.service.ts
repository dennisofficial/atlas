import { randomUUID } from 'node:crypto'

import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common'
import { TRPCError } from '@trpc/server'
import { ControlPlane, type ControlTerminalRow } from '@dltech/atlas-control'
import {
  ECallStatus,
  ELiveOpFailure,
  MAX_TERMINALS,
  type CallOp,
  type CallResult,
  type TerminalListOutput,
  type TerminalMutationOutput,
  type TerminalOpenOutput,
  type TerminalReadOutput,
  type TerminalRow,
} from '@dltech/atlas-protocol'
import { POD_OPS, type PodOps } from '../../../agent'
import { PodParkedError } from './pod-parked.error'
import { SessionsService } from './sessions.service'

type OkResult = Extract<CallResult, { status: ECallStatus.Ok }>
type OpenResult = Extract<OkResult, { op: 'terminal.open' }>
type ReadResult = Extract<OkResult, { op: 'terminal.read' }>

const UNKNOWN_TERMINAL = 'no terminal '

const rowOf = (row: ControlTerminalRow): TerminalRow => ({
  terminalId: row.terminalId,
  ordinal: row.ordinal,
  name: row.name,
  state: row.state,
  exitCode: row.exitCode,
  signal: row.signal,
  endedReason: row.endedReason,
  createdAt: Date.parse(row.createdAt),
  endedAt: row.endedAt === null ? null : Date.parse(row.endedAt),
})

@Injectable()
export class TerminalService {
  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Optional() @Inject(POD_OPS) private readonly ops: PodOps | null = null,
  ) {}

  private async requireSession(args: { userId: string; sessionId: string }): Promise<void> {
    await this.sessions.requireOwnedSession(args)
  }

  private async invoke(args: { sessionId: string; op: CallOp }): Promise<CallResult> {
    if (this.ops === null) throw new ServiceUnavailableException('pod access is not running')
    const outcome = await this.ops.invoke({ ...args, waitForHolder: true })
    if (outcome.state === 'unavailable') {
      if (outcome.reason === ELiveOpFailure.Asleep) throw new PodParkedError()
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'this pod op is not allowed' })
    }
    return outcome.result
  }

  private async invokeOrDone(args: { sessionId: string; op: CallOp }): Promise<CallResult | null> {
    try {
      return await this.invoke(args)
    } catch (error) {
      if (error instanceof PodParkedError) return null
      throw error
    }
  }

  private async requireRow(args: {
    sessionId: string
    terminalId: string
  }): Promise<ControlTerminalRow> {
    const row = await this.plane.readTerminal(args)
    if (row === undefined)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'no such terminal for this session' })
    return row
  }

  async requireOwned(args: { userId: string; sessionId: string }): Promise<void> {
    await this.requireSession(args)
  }

  async recordExit(args: {
    sessionId: string
    terminalId: string
    exitCode: number | null
    signal: string | null
  }): Promise<void> {
    await this.plane.endTerminal({
      sessionId: args.sessionId,
      terminalId: args.terminalId,
      reason: 'exited',
      exitCode: args.exitCode,
      signal: args.signal,
    })
  }

  async list(args: { userId: string; sessionId: string }): Promise<TerminalListOutput> {
    await this.requireSession(args)
    const rows = await this.plane.listTerminals({ sessionId: args.sessionId })
    return { terminals: rows.map(rowOf) }
  }

  async open(args: {
    userId: string
    sessionId: string
    cols: number
    rows: number
    cwd?: string | undefined
  }): Promise<TerminalOpenOutput> {
    await this.requireSession(args)
    const terminalId = randomUUID()
    const row = await this.plane.createTerminal({
      sessionId: args.sessionId,
      terminalId,
      limit: MAX_TERMINALS,
    })
    if (row === undefined)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `this session already has ${MAX_TERMINALS} terminals`,
      })
    const result = await this.invoke({
      sessionId: args.sessionId,
      op: {
        op: 'terminal.open',
        terminalId,
        cols: args.cols,
        rows: args.rows,
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
      },
    }).catch(async (error: unknown) => {
      await this.plane.deleteTerminal({ sessionId: args.sessionId, terminalId })
      throw error
    })
    if (result.status === ECallStatus.Failed) {
      await this.plane.deleteTerminal({ sessionId: args.sessionId, terminalId })
      throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message })
    }
    const opened = result as OpenResult
    await this.plane.markTerminalOpen({ sessionId: args.sessionId, terminalId })
    return { state: 'open', terminalId: opened.value.terminalId, pid: opened.value.pid }
  }

  async rename(args: {
    userId: string
    sessionId: string
    terminalId: string
    name: string
  }): Promise<TerminalMutationOutput> {
    await this.requireSession(args)
    await this.requireRow(args)
    await this.plane.renameTerminal({
      sessionId: args.sessionId,
      terminalId: args.terminalId,
      name: args.name,
    })
    return { state: 'done' }
  }

  async write(args: {
    userId: string
    sessionId: string
    terminalId: string
    data: string
  }): Promise<TerminalMutationOutput> {
    await this.requireSession(args)
    await this.requireRow(args)
    return this.invoke({
      sessionId: args.sessionId,
      op: { op: 'terminal.write', terminalId: args.terminalId, data: args.data },
    }).then((result) => this.mutationOf({ ...args, result }))
  }

  async resize(args: {
    userId: string
    sessionId: string
    terminalId: string
    cols: number
    rows: number
  }): Promise<TerminalMutationOutput> {
    await this.requireSession(args)
    await this.requireRow(args)
    return this.invoke({
      sessionId: args.sessionId,
      op: { op: 'terminal.resize', terminalId: args.terminalId, cols: args.cols, rows: args.rows },
    }).then((result) => this.mutationOf({ ...args, result }))
  }

  async close(args: {
    userId: string
    sessionId: string
    terminalId: string
  }): Promise<TerminalMutationOutput> {
    await this.requireSession(args)
    await this.requireRow(args)
    const result = await this.invokeOrDone({
      sessionId: args.sessionId,
      op: { op: 'terminal.close', terminalId: args.terminalId },
    })
    if (result !== null && result.status === ECallStatus.Failed)
      throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message })
    await this.plane.deleteTerminal({ sessionId: args.sessionId, terminalId: args.terminalId })
    return { state: 'done' }
  }

  async read(args: {
    userId: string
    sessionId: string
    terminalId: string
    offset: number
  }): Promise<TerminalReadOutput> {
    await this.requireSession(args)
    await this.requireRow(args)
    const result = await this.invoke({
      sessionId: args.sessionId,
      op: { op: 'terminal.read', terminalId: args.terminalId, offset: args.offset },
    })
    if (result.status === ECallStatus.Failed) {
      if (!result.error.message.startsWith(UNKNOWN_TERMINAL))
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.error.message })
      await this.endLost(args)
      return { offset: 0, data: '', totalBytes: 0, exited: { exitCode: null, signal: null } }
    }
    return (result as ReadResult).value
  }

  private async mutationOf(args: {
    result: CallResult | null
    sessionId: string
    terminalId: string
  }): Promise<TerminalMutationOutput> {
    if (args.result === null) return { state: 'parked' }
    if (args.result.status !== ECallStatus.Failed) return { state: 'done' }
    if (args.result.error.message.startsWith(UNKNOWN_TERMINAL)) await this.endLost(args)
    throw new TRPCError({ code: 'BAD_REQUEST', message: args.result.error.message })
  }

  /** A pod that booted fresh knows none of the terminals its predecessor ran, and never will. */
  private async endLost(args: { sessionId: string; terminalId: string }): Promise<void> {
    await this.plane.endTerminal({
      sessionId: args.sessionId,
      terminalId: args.terminalId,
      reason: 'pod-slept',
    })
  }
}
