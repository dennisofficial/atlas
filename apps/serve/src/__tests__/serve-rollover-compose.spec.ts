import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toRunId } from '@dltech/atlas-core'
import {
  EClientFrame,
  EServeFrame,
  ETurnStatus,
  readSandboxRotationReceipt,
  toSendId,
} from '@dltech/atlas-harness'
import type { SandboxDeadlineObservation } from '@dltech/atlas-wire'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'
import { connect } from './client'
import { fakeServeApp } from './fakes'
import {
  CONTROL_PLANE,
  gate,
  hello,
  inMemoryContextFiles,
  releaseServeSpec,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

const HOUR = 60 * 60_000
const BOOT = 1_000_000
const homes: string[] = []
const handles: ServeHandle[] = []
let heldHome: string | undefined

afterEach(async () => {
  while (handles.length > 0) await handles.pop()?.close()
  await releaseServeSpec()
  if (heldHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldHome
  heldHome = undefined
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('serve composes the 24h rollover', () => {
  it('a family working at the session cap drains, hands off to the API, then exits', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-serve-rollover-spec-'))
    homes.push(home)
    heldHome ??= process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
    let now = BOOT
    const order: string[] = []
    const exited = gate()
    const app = {
      ...fakeServeApp({
        threadId,
        root: '/workspace',
        intake: true,
        runTurn: async ({ pause }) => {
          order.push('turn-started')
          while (pause?.paused !== true) await Bun.sleep(1)
          order.push('turn-paused')
          return { status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') }
        },
      }),
      family: {
        freeze: async () => undefined,
        pauseChildren: async () => {
          order.push('children-paused')
        },
        resumeChildren: async () => undefined,
      },
    }
    const handle = await startServe({
      threadId,
      port: 0,
      token: TOKEN,
      controlPlaneUrl: CONTROL_PLANE,
      env: { ATLAS_SANDBOX_SESSION_ID: 'session-1' },
      cwd: '/workspace',
      compose: async () => app,
      write: () => undefined,
      now: () => now,
      deadlineTickMs: 5,
      idleTickMs: 5,
      deadlineControl: {
        renew: async ({ until }): Promise<SandboxDeadlineObservation> => ({
          sessionId: 'session-1',
          expiresAt: until,
          startedAt: BOOT,
          extendedByMs: 0,
        }),
        rollover: async () => {
          order.push('rollover-requested')
          return { dispatched: true }
        },
      },
      exit: (code) => {
        order.push(`exit-${code}`)
        exited.open()
      },
      contextFiles: inMemoryContextFiles(),
      ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
      fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    })
    handles.push(handle)
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: toSendId('send-go'), text: 'go' })
    await Bun.sleep(30)
    expect(order).toContain('turn-started')
    expect(order).not.toContain('rollover-requested')

    now = BOOT + 24 * HOUR - 30 * 60_000
    await exited.opened

    const receipt = await readSandboxRotationReceipt({ atlasHome: home })
    expect(receipt?.resumeParent).toBe(true)
    expect(order.indexOf('turn-paused')).toBeLessThan(order.indexOf('rollover-requested'))
    expect(order.indexOf('rollover-requested')).toBeLessThan(order.indexOf('exit-0'))
    expect(order.filter((step) => step === 'rollover-requested')).toHaveLength(1)
  })
})
