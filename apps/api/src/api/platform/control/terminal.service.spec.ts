import { describe, expect, it, vi } from 'bun:test'
import type { ControlPlane, ControlTerminalRow } from '@dltech/atlas-control'
import type { PodCallOutcome } from '@dltech/atlas-host'
import {
  ECallFailure,
  ECallStatus,
  ELiveOpFailure,
  MAX_TERMINALS,
  type CallOp,
  type CallResult,
} from '@dltech/atlas-protocol'
import type { PodOps } from '../../../agent'
import { PodParkedError } from './pod-parked.error'
import { TerminalService } from './terminal.service'
import type { SessionsService } from './sessions.service'

const rowOf = (over: Partial<ControlTerminalRow> = {}): ControlTerminalRow => ({
  sessionId: 's1',
  terminalId: 't1',
  ordinal: 1,
  name: 'Terminal 1',
  state: 'open',
  exitCode: null,
  signal: null,
  endedReason: null,
  createdAt: '2026-11-19T00:00:00.000Z',
  endedAt: null,
  ...over,
})

const planeOf = () => ({
  listTerminals: vi.fn(async () => [rowOf()]),
  readTerminal: vi.fn(async () => rowOf()),
  createTerminal: vi.fn(async (_args: { sessionId: string; terminalId: string; limit: number }) =>
    rowOf({ state: 'opening' }),
  ),
  renameTerminal: vi.fn(async () => rowOf()),
  markTerminalOpen: vi.fn(async () => undefined),
  endTerminal: vi.fn(async () => rowOf({ state: 'ended', endedReason: 'pod-slept' })),
  endTerminals: vi.fn(async () => 1),
  deleteTerminal: vi.fn(async () => undefined),
  revoke: vi.fn(),
})

const okOf = (result: CallResult) => ({ state: 'ok' as const, result })

const parked: PodCallOutcome = {
  state: 'unavailable',
  reason: ELiveOpFailure.Asleep,
}

const opsOf = (answer: (op: CallOp) => PodCallOutcome) => ({
  invoke: vi.fn(
    async (args: { op: CallOp; waitForHolder?: boolean | undefined }): Promise<PodCallOutcome> =>
      answer(args.op),
  ),
})

const owned = () => ({ requireOwnedSession: vi.fn(async () => undefined) })

const serviceOf = (plane: ReturnType<typeof planeOf>, ops: ReturnType<typeof opsOf>) =>
  new TerminalService(
    plane as unknown as ControlPlane,
    owned() as unknown as SessionsService,
    ops as unknown as PodOps,
  )

describe('TerminalService', () => {
  it('lists rows without touching the pod', async () => {
    const plane = planeOf()
    const ops = opsOf(() => okOf({ status: ECallStatus.Ok, op: 'terminal.write', value: null }))
    const out = await serviceOf(plane, ops).list({ userId: 'u1', sessionId: 's1' })
    expect(out.terminals[0]?.terminalId).toBe('t1')
    expect(out.terminals[0]?.createdAt).toBe(Date.parse('2026-11-19T00:00:00.000Z'))
    expect(ops.invoke).not.toHaveBeenCalled()
  })

  it('opening mints the id, claims the next ordinal row and marks it open', async () => {
    const plane = planeOf()
    const ops = opsOf(() => ({
      state: 'ok',
      result: {
        status: ECallStatus.Ok,
        op: 'terminal.open',
        value: { terminalId: 'minted', pid: 42 },
      } as CallResult,
    }))
    const out = await serviceOf(plane, ops).open({
      userId: 'u1',
      sessionId: 's1',
      cols: 80,
      rows: 24,
    })
    const minted = plane.createTerminal.mock.calls[0]?.[0]
    expect(plane.createTerminal).toHaveBeenCalledWith({
      sessionId: 's1',
      terminalId: minted?.terminalId ?? '',
      limit: MAX_TERMINALS,
    })
    expect(ops.invoke).toHaveBeenCalledWith({
      sessionId: 's1',
      op: {
        op: 'terminal.open',
        terminalId: minted?.terminalId ?? '',
        cols: 80,
        rows: 24,
      },
      waitForHolder: true,
    })
    expect(plane.markTerminalOpen).toHaveBeenCalledWith({
      sessionId: 's1',
      terminalId: minted?.terminalId ?? '',
    })
    expect(out).toEqual({ state: 'open', terminalId: 'minted', pid: 42 })
  })

  it('refuses to open past the cap', async () => {
    const plane = planeOf()
    plane.createTerminal.mockResolvedValueOnce(undefined as never)
    const ops = opsOf(() => parked)
    await expect(
      serviceOf(plane, ops).open({ userId: 'u1', sessionId: 's1', cols: 80, rows: 24 }),
    ).rejects.toThrow(`${MAX_TERMINALS} terminals`)
    expect(ops.invoke).not.toHaveBeenCalled()
  })

  it('deletes the row and surfaces the unheld session when no holder arrives', async () => {
    const plane = planeOf()
    const ops = opsOf(() => parked)
    await expect(
      serviceOf(plane, ops).open({ userId: 'u1', sessionId: 's1', cols: 80, rows: 24 }),
    ).rejects.toBeInstanceOf(PodParkedError)
    expect(plane.deleteTerminal).toHaveBeenCalledTimes(1)
    expect(plane.markTerminalOpen).not.toHaveBeenCalled()
  })

  it('write and resize surface the unheld session and keep the row', async () => {
    const plane = planeOf()
    const ops = opsOf(() => parked)
    const service = serviceOf(plane, ops)
    await expect(
      service.write({ userId: 'u1', sessionId: 's1', terminalId: 't1', data: 'x' }),
    ).rejects.toBeInstanceOf(PodParkedError)
    await expect(
      service.resize({ userId: 'u1', sessionId: 's1', terminalId: 't1', cols: 10, rows: 5 }),
    ).rejects.toBeInstanceOf(PodParkedError)
    expect(ops.invoke.mock.calls.map((call) => call[0].op.op)).toEqual([
      'terminal.write',
      'terminal.resize',
    ])
    expect(ops.invoke.mock.calls.map((call) => call[0].waitForHolder)).toEqual([true, true])
    expect(plane.deleteTerminal).not.toHaveBeenCalled()
  })

  it('close deletes the row even when the pod is parked', async () => {
    const plane = planeOf()
    const ops = opsOf(() => parked)
    const out = await serviceOf(plane, ops).close({
      userId: 'u1',
      sessionId: 's1',
      terminalId: 't1',
    })
    expect(out).toEqual({ state: 'done' })
    expect(ops.invoke).toHaveBeenCalledWith({
      sessionId: 's1',
      op: { op: 'terminal.close', terminalId: 't1' },
      waitForHolder: true,
    })
    expect(plane.deleteTerminal).toHaveBeenCalledWith({ sessionId: 's1', terminalId: 't1' })
  })

  it('rename stays in the control plane', async () => {
    const plane = planeOf()
    const ops = opsOf(() => parked)
    const out = await serviceOf(plane, ops).rename({
      userId: 'u1',
      sessionId: 's1',
      terminalId: 't1',
      name: 'build',
    })
    expect(out).toEqual({ state: 'done' })
    expect(plane.renameTerminal).toHaveBeenCalledWith({
      sessionId: 's1',
      terminalId: 't1',
      name: 'build',
    })
    expect(ops.invoke).not.toHaveBeenCalled()
  })

  it('a parked read throws PodParkedError', async () => {
    const plane = planeOf()
    const ops = opsOf(() => parked)
    await expect(
      serviceOf(plane, ops).read({ userId: 'u1', sessionId: 's1', terminalId: 't1', offset: 0 }),
    ).rejects.toBeInstanceOf(PodParkedError)
  })

  it('read repairs a terminal the pod no longer has', async () => {
    const plane = planeOf()
    const ops = opsOf(() => ({
      state: 'ok',
      result: {
        status: ECallStatus.Failed,
        op: 'terminal.read',
        error: { code: ECallFailure.NotFound, message: 'no terminal t1' },
      } as CallResult,
    }))
    const out = await serviceOf(plane, ops).read({
      userId: 'u1',
      sessionId: 's1',
      terminalId: 't1',
      offset: 12,
    })
    expect(plane.endTerminal).toHaveBeenCalledWith({
      sessionId: 's1',
      terminalId: 't1',
      reason: 'pod-slept',
    })
    expect(out).toEqual({
      offset: 0,
      data: '',
      totalBytes: 0,
      exited: { exitCode: null, signal: null },
    })
  })

  it('write ends a terminal the pod no longer has instead of leaving the row open', async () => {
    const plane = planeOf()
    const ops = opsOf(() => ({
      state: 'ok',
      result: {
        status: ECallStatus.Failed,
        op: 'terminal.write',
        error: { code: ECallFailure.NotFound, message: 'no terminal t1' },
      } as CallResult,
    }))
    await expect(
      serviceOf(plane, ops).write({ userId: 'u1', sessionId: 's1', terminalId: 't1', data: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'no terminal t1' })
    expect(plane.endTerminal).toHaveBeenCalledWith({
      sessionId: 's1',
      terminalId: 't1',
      reason: 'pod-slept',
    })
  })

  it('write keeps the row when the pod refuses for another reason', async () => {
    const plane = planeOf()
    const ops = opsOf(() => ({
      state: 'ok',
      result: {
        status: ECallStatus.Failed,
        op: 'terminal.write',
        error: { code: ECallFailure.InvalidInput, message: 'terminal t1 is closed' },
      } as CallResult,
    }))
    await expect(
      serviceOf(plane, ops).write({ userId: 'u1', sessionId: 's1', terminalId: 't1', data: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'terminal t1 is closed' })
    expect(plane.endTerminal).not.toHaveBeenCalled()
  })

  it('read replays the pod answer for a live terminal', async () => {
    const plane = planeOf()
    const value = { offset: 4, data: 'aGk=', totalBytes: 6, exited: null }
    const ops = opsOf(() => ({
      state: 'ok',
      result: { status: ECallStatus.Ok, op: 'terminal.read', value } as CallResult,
    }))
    const out = await serviceOf(plane, ops).read({
      userId: 'u1',
      sessionId: 's1',
      terminalId: 't1',
      offset: 4,
    })
    expect(out).toEqual(value)
    expect(plane.endTerminal).not.toHaveBeenCalled()
  })

  it('leaves asking for a holder to the pod ops', async () => {
    const plane = planeOf()
    const ops = opsOf(() => parked)
    const service = serviceOf(plane, ops)
    await service.list({ userId: 'u1', sessionId: 's1' })
    await service.open({ userId: 'u1', sessionId: 's1', cols: 80, rows: 24 }).catch(() => undefined)
    await service.rename({ userId: 'u1', sessionId: 's1', terminalId: 't1', name: 'x' })
    await service
      .write({ userId: 'u1', sessionId: 's1', terminalId: 't1', data: 'x' })
      .catch(() => undefined)
    await service
      .resize({ userId: 'u1', sessionId: 's1', terminalId: 't1', cols: 10, rows: 5 })
      .catch(() => undefined)
    await service.close({ userId: 'u1', sessionId: 's1', terminalId: 't1' })
    await service
      .read({ userId: 'u1', sessionId: 's1', terminalId: 't1', offset: 0 })
      .catch(() => undefined)
    expect(plane.revoke).not.toHaveBeenCalled()
  })
})
