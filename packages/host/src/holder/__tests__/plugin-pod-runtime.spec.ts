import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'
import { EMPTY_CREW, type PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { shellsPod } from '@dltech/atlas-plugin-shells/pod'
import {
  ECallStatus,
  EShellRunStatus,
  type CallOp,
  type CallResult,
  type DaemonEventFrame,
  type LiveFrame,
} from '@dltech/atlas-protocol'

import type { RemoteHello } from '../../calls/remote-calls'
import type { HeldSessionDeps } from '../held-session-deps'
import { pluginPodContextOf } from '../plugin-pod'
import type { SessionRuntime } from '../ports'
import type { SessionRecord } from '../record/record-adapter'

const rig = () => {
  const events = new Set<(frame: DaemonEventFrame) => void>()
  const ready = new Set<(hello: RemoteHello) => void>()
  const closed = new Set<() => void>()
  const frames: LiveFrame[] = []
  let text = 'hello\n'
  const invoke = async ({ op }: { op: CallOp }): Promise<CallResult> => {
    if (op.op === 'shells.list') return { status: ECallStatus.Ok, op: op.op, value: [] }
    if (op.op !== 'shells.read') throw new Error(`unexpected op ${op.op}`)
    const buffer = Buffer.from(text)
    return {
      status: ECallStatus.Ok,
      op: op.op,
      value: {
        offset: op.offset,
        bytes: buffer.subarray(op.offset, op.offset + op.limit).toString('base64'),
        totalBytes: buffer.length,
        info: {
          shellId: op.shellId,
          command: 'ticker',
          pid: 123,
          startedAt: '2026-11-28T00:00:00Z',
          status: EShellRunStatus.Running,
          exitCode: null,
          signal: null,
          totalBytes: buffer.length,
        },
      },
    }
  }
  const runtime = {
    launchDirectory: '/work',
    remoteCalls: {
      invoke,
      ack: async () => undefined,
      bootId: () => 'boot-1',
      onEvent: (listener: (frame: DaemonEventFrame) => void) => {
        events.add(listener)
        return () => void events.delete(listener)
      },
      onReady: (listener: (hello: RemoteHello) => void) => {
        ready.add(listener)
        return () => void ready.delete(listener)
      },
      onClose: (listener: () => void) => {
        closed.add(listener)
        return () => void closed.delete(listener)
      },
    },
  } as unknown as SessionRuntime
  const deps = {
    sessionId: 'session-1',
    ids: { nextRunId: () => toRunId('run-1') },
    bus: { live: async ({ frame }: { frame: LiveFrame }) => void frames.push(frame) },
  } as unknown as HeldSessionDeps
  const record = {
    eventCache: () => ({ eventsAfter: () => [] }),
  } as unknown as SessionRecord
  const context = (thread: string) => {
    const abort = new AbortController()
    const ctx = pluginPodContextOf({
      deps,
      runtime,
      record,
      threadId: toThreadId(thread),
      signal: abort.signal,
      crew: EMPTY_CREW,
    })
    shellsPod.hooks?.(ctx)
    return { ctx, abort }
  }
  const output = () => {
    for (const listener of events)
      listener({
        kind: 'event',
        event: { type: 'shells.output', shellId: 'shell-1', totalBytes: Buffer.byteLength(text) },
      })
  }
  return {
    context,
    frames,
    events,
    ready,
    closed,
    output,
    print: (value: string) => {
      text = value
    },
  }
}

const read = async (ctx: PluginPodContext) => {
  const tool = shellsPod.tools?.(ctx).find((tool) => tool.name === 'shell_output')
  if (tool === undefined) throw new Error('missing shell output tool')
  return await tool.invoke({
    input: { shellId: 'shell-1' },
    signal: new AbortController().signal,
    idempotencyKey: 'read',
    projectDirectory: '/work',
    threadId: toThreadId('thread-1'),
  })
}

const settle = async () => {
  for (let turns = 0; turns < 20; turns += 1) await Bun.sleep(1)
}

describe('a held runtime shared by main and child plugin contexts', () => {
  it('shares a publisher, keeps tool cursors local, and outlives the originating child', async () => {
    const harness = rig()
    const child = harness.context('child')
    const main = harness.context('main')
    expect(child.ctx.runtime).toBe(main.ctx.runtime)
    harness.output()
    await settle()
    expect(harness.frames).toEqual([
      { type: 'shell-output', shellId: 'shell-1', offset: 0, text: 'hello\n' },
    ])
    expect(await read(main.ctx)).toMatchObject({ ok: true, output: { text: 'hello\n' } })
    expect(await read(main.ctx)).toMatchObject({ ok: true, output: { text: '' } })
    expect(await read(child.ctx)).toMatchObject({ ok: true, output: { text: 'hello\n' } })

    child.abort.abort()
    harness.print('hello\nmore\n')
    harness.output()
    await settle()
    expect(harness.frames.at(-1)).toEqual({
      type: 'shell-output',
      shellId: 'shell-1',
      offset: 6,
      text: 'more\n',
    })
    expect(harness.events.size).toBe(2)
  })

  it('resets once per changed daemon boot and disposes on runtime close', async () => {
    const harness = rig()
    harness.context('main')
    harness.context('child')
    harness.output()
    await settle()
    for (const listener of harness.ready) listener({ bootId: 'boot-1', restart: false })
    harness.output()
    await settle()
    expect(harness.frames).toHaveLength(1)

    for (const listener of harness.ready) listener({ bootId: 'boot-2', restart: true })
    harness.print('fresh\n')
    harness.output()
    await settle()
    expect(harness.frames.at(-1)).toEqual({
      type: 'shell-output',
      shellId: 'shell-1',
      offset: 0,
      text: 'fresh\n',
    })
    for (const listener of harness.closed) listener()
    expect(harness.ready.size).toBe(0)
    expect(harness.closed.size).toBe(0)
    expect(harness.events.size).toBe(2)
    harness.print('fresh\nafter close\n')
    harness.output()
    await settle()
    expect(harness.frames).toHaveLength(2)
  })
})
