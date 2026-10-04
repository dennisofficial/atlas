import { it, expect } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'
import { EClientFrame, EClientRequest, encodeFrame, readSandboxRotationReceipt, transcriptIdentityDigest } from '@dltech/atlas-harness'

import { createFrameBuffer } from '../frame-buffer'
import { createRuntimeCheckpointCapture } from '../runtime-checkpoint'
import { bindRuntimeCheckpoint } from '../runtime-checkpoint-binding'
import { bindServeDrain } from '../serve-drain-binding'
import { createSessionHandlers, type SessionSocket } from '../socket-session'
import { createTurnDriver } from '../turn-driver'
import { fakeServeApp } from './fakes'

const noop = (): void => undefined
const gate = () => {
  let release = (): void => undefined
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

it('waits for an accepted restore before confirming family pause or persisting the preparation proof', async () => {
  const atlasHome = await mkdtemp(join(tmpdir(), 'atlas-mutation-preparation-'))
  const threadId = toThreadId('mutation-owner')
  const app = fakeServeApp({ threadId, root: '/workspace' })
  const held = gate()
  const entered = gate()
  const admission = { closed: false }
  const order: string[] = []
  const driver = createTurnDriver({
    app, threadId, onTurnStarted: noop, onTurnEnded: noop, onOutcome: noop, onFailure: noop,
  })
  const handlers = createSessionHandlers({
    threadId, driver, buffer: createFrameBuffer({ capacity: 10 }),
    inFlight: () => [], liveStepId: () => null, files: app.files, refusal: () => null,
    admissionClosed: () => admission.closed, log: noop,
    restoreTranscript: async () => {
      entered.release()
      await held.promise
      await app.log.append({ threadId, runId: app.ids.nextRunId(), drafts: [{ type: 'user-said', text: 'restored transcript' }] })
      order.push('restore-complete')
      return { restored: true, failed: null }
    },
  })
  const checkpoint = bindRuntimeCheckpoint({
    capture: createRuntimeCheckpointCapture({
      threadId, atlasHome, env: { ATLAS_SANDBOX_SESSION_ID: 'source' }, token: 'test-only', transcript: app.log, log: noop,
    }), log: noop, publish: noop,
  })
  const drain = bindServeDrain({
    app, driver, threadId, atlasHome, sandboxSessionId: 'source', admission,
    haltIdle: noop, whenMutationsSettled: handlers.whenSettled,
    checkpoint, close: async () => undefined, exit: noop, log: noop,
  })
  const socket = { data: { helloed: true, alias: null }, send: () => 0 } as unknown as SessionSocket
  try {
    handlers.message({ socket, message: encodeFrame({ kind: EClientFrame.Request, id: 'restore', op: EClientRequest.RestoreTranscript, params: {} }) })
    await entered.promise
    const preparing = drain({ reason: 'update' }).then((proof) => { order.push('proof'); return proof })
    await Bun.sleep(10)
    expect(admission.closed).toBe(true)
    expect(await readSandboxRotationReceipt({ atlasHome })).toBeNull()
    expect(order).toEqual([])
    held.release()
    const proof = await preparing
    expect(order).toEqual(['restore-complete', 'proof'])
    expect(proof.receipt.checkpoint.transcript.digest).toBe(transcriptIdentityDigest(await app.log.read({ threadId })))
  } finally {
    held.release()
    await app.close()
    await rm(atlasHome, { recursive: true, force: true })
  }
})
