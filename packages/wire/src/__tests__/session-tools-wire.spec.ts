import { describe, expect, it } from 'bun:test'

import {
  decodeServeFrame,
  EChangeScope,
  EClientRequest,
  encodeFrame,
  EServeFrame,
  pendingEditReplySchema,
  readGitChangesParamsSchema,
  serviceSnapshotWireSchema,
  terminalOpenParamsSchema,
  terminalResizeParamsSchema,
  updatePendingParamsSchema,
} from '../index'

describe('git changes wire', () => {
  it('names the op and accepts exactly the three scopes', () => {
    expect(String(EClientRequest.ReadGitChanges)).toBe('read-git-changes')
    for (const scope of Object.values(EChangeScope)) {
      expect(readGitChangesParamsSchema.safeParse({ scope }).success).toBe(true)
    }
    expect(Object.values(EChangeScope).map(String)).toEqual(['all', 'uncommitted', 'last-commit'])
    expect(readGitChangesParamsSchema.safeParse({ scope: 'staged' }).success).toBe(false)
    expect(String(EChangeScope.LastCommit)).toBe('last-commit')
  })
})

describe('terminal wire', () => {
  it('bounds the dimensions', () => {
    expect(terminalOpenParamsSchema.safeParse({ cols: 80, rows: 24 }).success).toBe(true)
    expect(terminalOpenParamsSchema.safeParse({ cols: 0, rows: 24 }).success).toBe(false)
    expect(
      terminalResizeParamsSchema.safeParse({ terminalId: 't', cols: 9999, rows: 1 }).success,
    ).toBe(false)
  })

  it('round-trips output and exit frames', () => {
    const output = {
      kind: EServeFrame.TerminalOutput,
      terminalId: 'term_1',
      data: 'hi\r\n',
    } as const
    const exit = {
      kind: EServeFrame.TerminalExit,
      terminalId: 'term_1',
      exitCode: 0,
      signal: null,
    } as const
    expect(decodeServeFrame(encodeFrame(output))).toEqual(output)
    expect(decodeServeFrame(encodeFrame(exit))).toEqual(exit)
  })
})

describe('pending edit wire', () => {
  it('wants a thread, an id and non-empty text to update', () => {
    expect(
      updatePendingParamsSchema.safeParse({ threadId: 't', id: 'pending-1', text: 'x' }).success,
    ).toBe(true)
    expect(
      updatePendingParamsSchema.safeParse({ threadId: 't', id: 'pending-1', text: '' }).success,
    ).toBe(false)
    expect(pendingEditReplySchema.safeParse({ outcome: 'reserved' }).success).toBe(true)
  })
})

describe('service snapshot exposure', () => {
  it('keeps the exposure a service start returned', () => {
    const exposure = { containerPort: 3000, hostPort: 3000, url: 'https://x.test' }
    const parsed = serviceSnapshotWireSchema.parse({
      serviceId: 'svc_1',
      command: 'bun dev',
      description: 'dev server',
      status: 'running',
      logPath: '/tmp/log',
      startedAt: '2026-10-26T00:00:00.000Z',
      exposure,
    })
    expect(parsed.exposure).toEqual(exposure)
  })
})
