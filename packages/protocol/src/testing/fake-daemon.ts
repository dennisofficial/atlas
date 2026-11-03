import { createHmac } from 'node:crypto'

import { type SteppedCalls, initialCalls, stepCalls } from '@dltech/atlas-core'

import { EDaemonErrorKind, type DaemonFrame, type HostFrame } from '../frames'
import { FrameQueue, type DaemonSession, sessionOverQueue } from './client'
import { type InProcessLink, wireInProcessDuplex } from './duplex'
import { runFakeOp } from './fake-ops'
import { MemoryFileSystem } from './memory-files'

export type InMemoryDaemonOptions = {
  bootId: string
  version: string
  sandboxName?: string
  secret?: string
}

export type InMemoryDaemon = {
  bootId: string
  spawnCount(): number
  connect(): DaemonSession
}

type MemoryCall = {
  state: 'running' | 'done'
  output: Uint8Array[]
  result?: unknown
  cancel(): void
}

export const createInMemoryDaemon = (options: InMemoryDaemonOptions): InMemoryDaemon => {
  const fs = new MemoryFileSystem()
  const calls = new Map<string, MemoryCall>()
  let protocol: SteppedCalls = initialCalls({ bootId: options.bootId })
  let spawned = 0
  let current: { link: InProcessLink; epoch: number } | null = null

  const sendError = (
    link: InProcessLink,
    errorKind: EDaemonErrorKind,
    message: string,
    key?: string,
  ): void => {
    link.sendToClient(
      JSON.stringify({
        kind: 'error',
        ...(key === undefined ? {} : { key }),
        errorKind,
        message,
      } satisfies DaemonFrame),
    )
  }

  const hello = (frame: Extract<HostFrame, { kind: 'hello' }>, link: InProcessLink): void => {
    if (options.secret !== undefined) {
      const expected = inMemoryDaemonToken({
        secret: options.secret,
        sandboxName: options.sandboxName ?? '',
      })
      if (frame.token !== expected) {
        sendError(link, EDaemonErrorKind.Internal, 'bad token')
        link.closeFromServer(4001, 'bad token')
        return
      }
    }
    if (current !== null && current.link !== link && frame.epoch < current.epoch) {
      sendError(link, EDaemonErrorKind.StaleEpoch, 'stale epoch')
      link.closeFromServer(4002, 'stale epoch')
      return
    }
    if (current !== null && current.link !== link) {
      sendError(current.link, EDaemonErrorKind.StaleEpoch, 'superseded')
      current.link.closeFromServer(4002, 'superseded')
    }
    protocol = stepCalls({
      state: protocol,
      input: { type: 'hello', epoch: frame.epoch },
    }).state
    current = { link, epoch: frame.epoch }
    link.sendToClient(
      JSON.stringify({
        kind: 'hello-reply',
        bootId: options.bootId,
        version: options.version,
      } satisfies DaemonFrame),
    )
  }

  const run = (frame: Extract<HostFrame, { kind: 'run' }>, link: InProcessLink): void => {
    const send = (frame: DaemonFrame): void => {
      link.sendToClient(JSON.stringify(frame))
    }
    const known = calls.get(frame.key)
    if (known !== undefined) {
      if (known.state === 'running') {
        send({ kind: 'run-reply', key: frame.key, state: 'running' })
        return
      }
      let offset = 0
      for (const chunk of known.output) {
        send({
          kind: 'output',
          key: frame.key,
          offset,
          bytes: Buffer.from(chunk).toString('base64'),
        })
        offset += chunk.length
      }
      send({ kind: 'run-reply', key: frame.key, state: 'done' })
      send({ kind: 'result', key: frame.key, result: known.result as { exitCode: number | null } })
      return
    }

    let killed = false
    let done: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
      done = resolve
    })
    const call: MemoryCall = {
      state: 'running',
      output: [],
      cancel: () => {
        killed = true
        done()
      },
    }
    calls.set(frame.key, call)
    send({ kind: 'run-reply', key: frame.key, state: 'running' })

    void runFakeOp({
      op: frame.op,
      fs,
      countSpawn: () => {
        spawned += 1
      },
      killed: () => killed,
      finished,
      onChunk: (bytes) => {
        const offset = call.output.reduce((total, chunk) => total + chunk.length, 0)
        call.output.push(new Uint8Array(bytes))
        if (current?.link === link) {
          send({
            kind: 'output',
            key: frame.key,
            offset,
            bytes: Buffer.from(bytes).toString('base64'),
          })
        }
      },
    }).then((result) => {
      call.state = 'done'
      call.result = result
      protocol = stepCalls({
        state: protocol,
        input: { type: 'exit', key: frame.key, result: JSON.stringify(result) },
      }).state
      if (current?.link === link) {
        send({ kind: 'result', key: frame.key, result: result as { exitCode: number | null } })
      }
    })
  }

  const handle = (frame: HostFrame, link: InProcessLink): void => {
    if (frame.kind === 'hello') {
      hello(frame, link)
      return
    }
    if (frame.kind === 'ping') {
      link.sendToClient(JSON.stringify({ kind: 'pong' } satisfies DaemonFrame))
      return
    }
    if (frame.epoch < protocol.epoch) {
      sendError(link, EDaemonErrorKind.StaleEpoch, 'stale epoch', frame.key)
      return
    }
    if (frame.kind === 'run') {
      protocol = stepCalls({
        state: protocol,
        input: { type: 'run', key: frame.key, dispatched: true, epoch: frame.epoch },
      }).state
      run(frame, link)
      return
    }
    if (frame.kind === 'ack') {
      if (!calls.has(frame.key)) {
        sendError(link, EDaemonErrorKind.UnknownKey, `unknown key ${frame.key}`, frame.key)
        return
      }
      protocol = stepCalls({
        state: protocol,
        input: { type: 'ack', key: frame.key, resultRecorded: true, epoch: frame.epoch },
      }).state
      calls.delete(frame.key)
      return
    }
    const known = calls.get(frame.key)
    if (known === undefined) {
      sendError(link, EDaemonErrorKind.UnknownKey, `not running: ${frame.key}`, frame.key)
      return
    }
    known.cancel()
  }

  return {
    bootId: options.bootId,
    spawnCount: () => spawned,
    connect: () => {
      const queue = new FrameQueue()
      let resolveClosed: (value: { code: number; reason: string }) => void = () => {}
      const closed = new Promise<{ code: number; reason: string }>((resolve) => {
        resolveClosed = resolve
      })
      let link: InProcessLink
      link = wireInProcessDuplex({
        onServerText: (text) => {
          handle(JSON.parse(text) as HostFrame, link)
        },
        onClientText: (text) => {
          queue.push(JSON.parse(text) as DaemonFrame)
        },
        onServerClosed: (code, reason) => {
          resolveClosed({ code: code ?? 1000, reason: reason ?? '' })
        },
      })
      return sessionOverQueue({
        queue,
        send: (frame) => link.sendToServer(JSON.stringify(frame)),
        close: () => link.closeFromClient(),
        closed,
      })
    },
  }
}

export const inMemoryDaemonToken = (args: { secret: string; sandboxName: string }): string =>
  createHmac('sha256', args.secret).update(args.sandboxName).digest('hex')
