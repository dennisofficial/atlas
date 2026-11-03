import type { ServerWebSocket } from 'bun'

import {
  type CallOp,
  type CallResult,
  type DaemonFrame,
  EDaemonErrorKind,
  hostFrameSchema,
} from '@dltech/atlas-protocol'

import { WORKLOAD_CGROUP_ENV } from '@dltech/atlas-sandbox'

import { daemonTokenMatches } from './auth'
import { CallLedger, ELedgerError } from './calls/ledger'
import type { OpRegistry } from './ops/registry'
import { KeySubscription, daemonMemory } from './subscription'

export type DaemonConfig = {
  port: number
  home: string
  bootId: string
  version: string
  secret: string
  sandboxName: string
  env: Record<string, string | undefined>
  ops: OpRegistry
}

type Connection = {
  epoch: number | null
  subs: Map<string, KeySubscription>
}

const errorFrame = (args: {
  key?: string | undefined
  errorKind: EDaemonErrorKind
  message: string
}): DaemonFrame => ({
  kind: 'error',
  ...(args.key === undefined ? {} : { key: args.key }),
  errorKind: args.errorKind,
  message: args.message,
})

const errorKindOf = (error: ELedgerError): EDaemonErrorKind => {
  if (error === ELedgerError.StaleEpoch) return EDaemonErrorKind.StaleEpoch
  if (error === ELedgerError.UnknownKey) return EDaemonErrorKind.UnknownKey
  return EDaemonErrorKind.Internal
}

export type DaemonServer = {
  port: number
  stop(): void
}

const handleHello = (
  args: {
    config: DaemonConfig
    ledger: CallLedger
    current(): { ws: ServerWebSocket<Connection>; epoch: number } | null
    setCurrent(ws: ServerWebSocket<Connection>, epoch: number): void
  },
  ws: ServerWebSocket<Connection>,
  frame: { epoch: number; token: string },
): void => {
  const { config, ledger } = args
  const send = (frame: DaemonFrame): void => {
    ws.send(JSON.stringify(frame))
  }
  const tokenOk = daemonTokenMatches({
    secret: config.secret,
    sandboxName: config.sandboxName,
    token: frame.token,
  })
  if (!tokenOk) {
    send(errorFrame({ errorKind: EDaemonErrorKind.Internal, message: 'bad token' }))
    ws.close(4001, 'bad token')
    return
  }
  const current = args.current()
  if (current !== null && current.ws !== ws && frame.epoch < current.epoch) {
    send(errorFrame({ errorKind: EDaemonErrorKind.StaleEpoch, message: 'stale epoch' }))
    ws.close(4002, 'stale epoch')
    return
  }
  if (current !== null && current.ws !== ws) {
    current.ws.send(
      JSON.stringify(errorFrame({ errorKind: EDaemonErrorKind.StaleEpoch, message: 'superseded' })),
    )
    current.ws.close(4002, 'superseded')
  }
  ledger.hello({ epoch: frame.epoch })
  ws.data.epoch = frame.epoch
  args.setCurrent(ws, frame.epoch)
  send({ kind: 'hello-reply', bootId: config.bootId, version: config.version })
  const memory = daemonMemory(config.env[WORKLOAD_CGROUP_ENV])
  send({
    kind: 'health',
    bootId: config.bootId,
    version: config.version,
    ...(memory === undefined ? {} : { memory }),
  })
}

export const startDaemonServer = (args: {
  config: DaemonConfig
  ledger: CallLedger
}): DaemonServer => {
  const { config, ledger } = args
  let current: { ws: ServerWebSocket<Connection>; epoch: number } | null = null

  const send = (ws: ServerWebSocket<Connection>, frame: DaemonFrame): void => {
    ws.send(JSON.stringify(frame))
  }

  const subscribe = (ws: ServerWebSocket<Connection>, key: string): KeySubscription => {
    const existing = ws.data.subs.get(key)
    if (existing !== undefined) return existing
    const sub = new KeySubscription(key, (frame) => send(ws, frame))
    ws.data.subs.set(key, sub)
    ledger.subscribe({ key, sink: sub.sink })
    return sub
  }

  const replayDone = async (
    ws: ServerWebSocket<Connection>,
    done: { key: string; epoch: number; result: unknown },
  ): Promise<void> => {
    const replay = await ledger.reattach({ key: done.key, epoch: done.epoch, offset: 0 })
    if (replay.ok && replay.bytes.length > 0) {
      subscribe(ws, done.key).sendChunk({ offset: 0, bytes: replay.bytes })
    }
    send(ws, { kind: 'run-reply', key: done.key, state: 'done' })
    send(ws, { kind: 'result', key: done.key, result: done.result as CallResult })
  }

  const handleRun = async (
    ws: ServerWebSocket<Connection>,
    frame: { key: string; epoch: number; op: CallOp },
  ): Promise<void> => {
    const outcome = await ledger.run({ key: frame.key, epoch: frame.epoch, op: frame.op })
    if (!outcome.ok) {
      send(
        ws,
        errorFrame({
          key: frame.key,
          errorKind: errorKindOf(outcome.failure.error),
          message: outcome.failure.message,
        }),
      )
      return
    }
    if (outcome.state === 'done') {
      await replayDone(ws, { key: frame.key, epoch: frame.epoch, result: outcome.result })
      return
    }

    const sub = subscribe(ws, frame.key)
    const replay = await ledger.reattach({ key: frame.key, epoch: frame.epoch, offset: 0 })
    const floor = replay.ok ? replay.bytes.length : 0
    if (replay.ok && replay.bytes.length > 0) sub.sendChunk({ offset: 0, bytes: replay.bytes })
    sub.goLive({ floor })
    send(ws, { kind: 'run-reply', key: frame.key, state: 'running' })

    if (replay.ok && replay.state === 'done' && !sub.sentResult) {
      const settled = await ledger.run({ key: frame.key, epoch: frame.epoch, op: frame.op })
      if (settled.ok && settled.state === 'done' && !sub.sentResult) {
        send(ws, { kind: 'result', key: frame.key, result: settled.result as CallResult })
      }
    }
  }

  const handleAckOrCancel = async (
    ws: ServerWebSocket<Connection>,
    frame: { kind: 'ack' | 'cancel'; key: string; epoch: number },
  ): Promise<void> => {
    const outcome =
      frame.kind === 'ack'
        ? await ledger.ack({ key: frame.key, epoch: frame.epoch })
        : await ledger.cancel({ key: frame.key, epoch: frame.epoch })
    if (outcome.ok) return
    send(
      ws,
      errorFrame({
        key: frame.key,
        errorKind: errorKindOf(outcome.failure.error),
        message: outcome.failure.message,
      }),
    )
  }

  const handleFrame = async (ws: ServerWebSocket<Connection>, raw: string): Promise<void> => {
    let parsed: ReturnType<typeof hostFrameSchema.safeParse>
    try {
      parsed = hostFrameSchema.safeParse(JSON.parse(raw))
    } catch {
      send(ws, errorFrame({ errorKind: EDaemonErrorKind.Internal, message: 'invalid json' }))
      return
    }
    if (!parsed.success) {
      send(ws, errorFrame({ errorKind: EDaemonErrorKind.Internal, message: 'invalid frame' }))
      return
    }
    const frame = parsed.data
    if (frame.kind === 'hello') {
      handleHello(
        {
          config,
          ledger,
          current: () => current,
          setCurrent: (helloWs, epoch) => {
            current = { ws: helloWs, epoch }
          },
        },
        ws,
        frame,
      )
      return
    }
    if (frame.kind === 'ping') {
      send(ws, { kind: 'pong' })
      return
    }
    if (ws.data.epoch === null) {
      send(ws, errorFrame({ errorKind: EDaemonErrorKind.Internal, message: 'hello first' }))
      return
    }
    if (frame.kind === 'run') {
      await handleRun(ws, frame)
      return
    }
    await handleAckOrCancel(ws, frame)
  }

  const server = Bun.serve<Connection>({
    port: config.port,
    fetch(request, server) {
      const upgraded = server.upgrade(request, {
        data: { epoch: null, subs: new Map() },
      })
      if (upgraded) return undefined
      return new Response('atlas-daemon', { status: 200 })
    },
    websocket: {
      message(ws, message) {
        const text = typeof message === 'string' ? message : Buffer.from(message).toString('utf8')
        void handleFrame(ws, text)
      },
      close(ws) {
        for (const [key, sub] of ws.data.subs) ledger.unsubscribe({ key, sink: sub.sink })
        if (current?.ws === ws) current = null
      },
    },
  })

  return {
    port: server.port ?? config.port,
    stop: () => {
      server.stop(true)
    },
  }
}
