import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'

import { EClientFrame, EServeFrame, type ClientFrame } from '@dltech/atlas-harness'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'
import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect } from './client'
import { fakeServeApp, type FakeServeApp, type RunTurn } from './fakes'

const TOKEN = 'family-pause-token'
const threadId = toThreadId('thread-family-pause')
const CONTROL_PLANE = 'https://api.example.com'

const running: ServeHandle[] = []

const start = async (args: {
  runTurn?: RunTurn | undefined
  family?: { pauseChildren: (args: { threadId: typeof threadId }) => Promise<void> } | undefined
}): Promise<{ handle: ServeHandle; app: FakeServeApp }> => {
  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    runTurn: args.runTurn,
    ...(args.family === undefined ? {} : { family: args.family }),
  })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    compose: async () => app,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: (async (_input: unknown) => new Response(null, { status: 204 })) as typeof fetch,
  })
  running.push(handle)
  return { handle, app }
}

const hello = (): Extract<ClientFrame, { kind: EClientFrame.Hello }> => ({
  kind: EClientFrame.Hello,
  threadId,
  channelCursor: null,
  lastEventSeq: 0,
})

const gate = (): { opened: Promise<void>; open: () => void } => {
  let release = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  return { opened, open: () => release() }
}

const pauseBlocksTurn: RunTurn = ({ pause }) =>
  new Promise<TurnOutcome>((resolve) => {
    const check = () => {
      if (pause?.paused === true) {
        resolve({ status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') })
        return
      }
      setTimeout(check, 1)
    }
    check()
  })

const relocationPaused = (frame: { kind: EServeFrame; outcome?: unknown }): boolean =>
  frame.kind === EServeFrame.TurnEnded &&
  (frame.outcome as { status: ETurnStatus }).status === ETurnStatus.RelocationPaused

describe('pausing the whole family on a descend', () => {
  it('answers a failed pause with a readable error instead of relocation proof', async () => {
    const { handle } = await start({
      family: { pauseChildren: async () => { throw new Error('child ending could not be persisted') } },
    })
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello())
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Pause })
    const error = await client.waitFor((frame) => frame.kind === EServeFrame.Error)
    expect(error).toMatchObject({ kind: EServeFrame.Error, message: 'child ending could not be persisted' })
    expect(client.frames.some(relocationPaused)).toBe(false)
  })

  it('pauses the stepping children before the parent, so the archive never races a writer', async () => {
    const order: string[] = []
    const { handle } = await start({
      runTurn: pauseBlocksTurn,
      family: {
        pauseChildren: async () => {
          order.push('children')
        },
      },
    })
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello())
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(10)
    order.push('parent-pause-request')

    client.send({ kind: EClientFrame.Pause })
    await client.waitFor((frame) => relocationPaused(frame))

    expect(order).toEqual(['parent-pause-request', 'children'])
  })

  it('waits for the children to settle before answering the relocation-paused outcome', async () => {
    const children = gate()
    const { handle } = await start({
      runTurn: pauseBlocksTurn,
      family: {
        pauseChildren: async () => {
          await children.opened
        },
      },
    })
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello())
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(10)

    client.send({ kind: EClientFrame.Pause })
    await Bun.sleep(50)
    expect(client.frames.some((frame) => relocationPaused(frame))).toBe(false)

    children.open()
    await client.waitFor((frame) => relocationPaused(frame))
  })

  it('resumes the family by re-entering the paused turn from its durable log', async () => {
    const turns: number[] = []
    const { handle } = await start({
      runTurn: ({ pause }) => {
        turns.push(1)
        if (turns.length > 1) {
          return Promise.resolve({ status: ETurnStatus.Completed, runId: toRunId('run-2') })
        }
        return new Promise<TurnOutcome>((resolve) => {
          const check = () => {
            if (pause?.paused === true) {
              resolve({ status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') })
              return
            }
            setTimeout(check, 1)
          }
          check()
        })
      },
      family: { pauseChildren: async () => undefined },
    })
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello())
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(10)

    client.send({ kind: EClientFrame.Pause })
    await client.waitFor((frame) => relocationPaused(frame))

    client.send({ kind: EClientFrame.Resume })
    await client.waitFor(
      (frame) =>
        frame.kind === EServeFrame.TurnEnded &&
        (frame.outcome as { status: ETurnStatus }).status === ETurnStatus.Completed,
    )

    expect(turns).toEqual([1, 1])
  })

  it('serves without a family fake still pause their own turn', async () => {
    const { handle } = await start({ runTurn: pauseBlocksTurn })
    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello())
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(10)
    client.send({ kind: EClientFrame.Pause })

    await client.waitFor((frame) => relocationPaused(frame))
  })
})
