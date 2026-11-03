import { describe, expect, it, vi } from 'bun:test'
import type { ExpoPushReceipt, ExpoPushTicket } from '../../../_lib/expo-push/expo-push.client'
import type { PushSendDeps } from './push-send-run'
import { RECEIPT_DELAY_MS, runPushSend } from './push-send-run'
import type { PushSendPayload } from './push-send.contract'

const payload = (tokens: string[]): PushSendPayload => ({
  messages: tokens.map((to) => ({ to, title: 'T', body: 'B' })),
})

const fakeDeps = (over: Partial<PushSendDeps> = {}) => {
  const deps: PushSendDeps = {
    send: vi.fn(async (): Promise<ExpoPushTicket[]> => [{ status: 'ok', id: 'ticket-1' }]),
    getReceipts: vi.fn(
      async (): Promise<Record<string, ExpoPushReceipt>> => ({ 'ticket-1': { status: 'ok' } }),
    ),
    wait: vi.fn(async () => undefined),
    pruneTokens: vi.fn(async () => undefined),
    log: vi.fn(),
    ...over,
  }
  return deps
}

describe('runPushSend', () => {
  it('prunes DeviceNotRegistered tokens at ticket time and skips their receipts', async () => {
    const deps = fakeDeps({
      send: vi.fn(
        async (): Promise<ExpoPushTicket[]> => [
          { status: 'ok', id: 'ticket-ok' },
          { status: 'error', details: { error: 'DeviceNotRegistered' } },
        ],
      ),
    })
    const output = await runPushSend({ payload: payload(['good', 'dead']), deps })
    expect(deps.pruneTokens).toHaveBeenCalledWith(['dead'])
    expect(deps.getReceipts).toHaveBeenCalledWith(['ticket-ok'])
    expect(output).toEqual({ sent: 1, pruned: 1 })
  })

  it('waits 15 minutes, then prunes tokens dead at receipt time', async () => {
    const deps = fakeDeps({
      getReceipts: vi.fn(
        async (): Promise<Record<string, ExpoPushReceipt>> => ({
          'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } },
        }),
      ),
    })
    const output = await runPushSend({ payload: payload(['tok']), deps })
    expect(deps.wait).toHaveBeenCalledWith(RECEIPT_DELAY_MS)
    expect(deps.pruneTokens).toHaveBeenCalledWith(['tok'])
    expect(output).toEqual({ sent: 1, pruned: 1 })
  })

  it('logs a non-fatal ticket error without pruning', async () => {
    const deps = fakeDeps({
      send: vi.fn(async (): Promise<ExpoPushTicket[]> => [{ status: 'error', message: 'too big' }]),
    })
    const output = await runPushSend({ payload: payload(['tok']), deps })
    expect(deps.pruneTokens).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledTimes(1)
    expect(output).toEqual({ sent: 0, pruned: 0 })
  })

  it('swallows a receipts failure instead of retrying the send', async () => {
    const deps = fakeDeps({
      getReceipts: vi.fn(async () => {
        throw new Error('expo 502')
      }),
    })
    const output = await runPushSend({ payload: payload(['tok']), deps })
    expect(deps.log).toHaveBeenCalledTimes(1)
    expect(output).toEqual({ sent: 1, pruned: 0 })
  })

  it('propagates a whole-request send failure for the task retry', async () => {
    const deps = fakeDeps({
      send: vi.fn(async () => {
        throw new Error('expo 429')
      }),
    })
    await expect(runPushSend({ payload: payload(['tok']), deps })).rejects.toThrow('expo 429')
  })
})
