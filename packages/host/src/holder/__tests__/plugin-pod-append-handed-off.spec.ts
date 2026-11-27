import { describe, expect, it } from 'bun:test'

import { CallHandedOffError, EFinishReason, toRunId, toThreadId } from '@dltech/atlas-core'
import { EMPTY_CREW } from '@dltech/atlas-plugin-sdk'

import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import type { SessionRuntime } from '../ports'
import { LeaseLostError } from '../record/lease-lost-error'
import type { SessionRecord } from '../record/record-adapter'

const contextWith = (append: () => Promise<void>) =>
  pluginPodContextOf({
    deps: {
      sessionId: 'session-1',
      ids: { nextRunId: () => toRunId('run-1') },
    } as unknown as HeldSessionDeps,
    runtime: {
      launchDirectory: '/work',
      remoteCalls: { onEvent: () => () => undefined },
    } as unknown as SessionRuntime,
    record: { append } as unknown as SessionRecord,
    threadId: toThreadId('thread-1'),
    signal: new AbortController().signal,
    crew: EMPTY_CREW,
  })

const SAID = [
  {
    type: 'assistant-said',
    parts: [{ type: 'text', text: 'started' }],
    finish: EFinishReason.Stop,
  },
] as const

describe('PluginPodContext append across a hand-off', () => {
  it('reports a write the handed-back record refused as a handed-off call', async () => {
    const ctx = contextWith(async () => {
      throw new LeaseLostError('the holder self-fenced; no append is attempted', 'self-fenced')
    })

    await expect(ctx.append([...SAID])).rejects.toBeInstanceOf(CallHandedOffError)
  })

  it('reports any other record failure as it is', async () => {
    const ctx = contextWith(async () => {
      throw new LeaseLostError('the record store never answered in time', 'retry-exhausted')
    })

    await expect(ctx.append([...SAID])).rejects.toBeInstanceOf(LeaseLostError)
  })
})
