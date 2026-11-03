import {
  EDaemonErrorKind,
  daemonFrameSchema,
  hostFrameSchema,
  type DaemonFrame,
  type HostFrame,
} from '../frames'
import { daemonEventSchema, type DaemonEvent } from '../ops'
import { daemonTokenMatches } from './auth'
import {
  ECloseCode,
  opsOf,
  type DaemonEngineArgs,
  type EngineConnection,
  type EngineLink,
} from './connection'
import type { DaemonGroup } from './group'
import { CallLedger, type LedgerOutcome } from './ledger'

type Peer = { connection: EngineConnection; epoch: number | null; live: boolean }

export class DaemonEngine {
  private readonly ledger: CallLedger
  private readonly groups: readonly DaemonGroup[]
  private current: Peer | null = null

  constructor(private readonly args: DaemonEngineArgs) {
    this.groups = args.groups.map((factory) => factory({ publish: (event) => this.publish(event) }))
    this.ledger = new CallLedger({
      store: args.store,
      bootId: args.bootId,
      ops: opsOf(this.groups),
      publish: (event) => this.publish(event),
      onFault: args.onFault,
    })
  }

  async open(): Promise<void> {
    await this.ledger.open()
  }

  runCount(): number {
    return this.ledger.runCount()
  }

  async stop(): Promise<void> {
    this.ledger.abortAll()
    for (const group of this.groups) await group.stop?.()
  }

  connect(connection: EngineConnection): EngineLink {
    const peer: Peer = { connection, epoch: null, live: true }
    return {
      receive: (text) => this.receive({ peer, text }),
      closed: () => this.disconnect(peer),
    }
  }

  private publish(event: DaemonEvent): void {
    const peer = this.current
    if (peer === null) return
    const parsed = daemonEventSchema.safeParse(event)
    if (!parsed.success) {
      this.args.onFault({ error: new Error(`invalid event: ${parsed.error.message}`) })
      return
    }
    this.send({ peer, frame: { kind: 'event', event: parsed.data } })
  }

  private send(args: { peer: Peer; frame: DaemonFrame }): void {
    if (!args.peer.live) return
    const checked = daemonFrameSchema.safeParse(args.frame)
    if (!checked.success) {
      this.args.onFault({
        error: new Error(`refusing to send ${args.frame.kind}: ${checked.error.message}`),
      })
      return
    }
    args.peer.connection.send(JSON.stringify(checked.data))
  }

  private error(args: {
    peer: Peer
    errorKind: EDaemonErrorKind
    message: string
    key?: string | undefined
  }): void {
    this.send({
      peer: args.peer,
      frame: {
        kind: 'error',
        ...(args.key === undefined ? {} : { key: args.key }),
        errorKind: args.errorKind,
        message: args.message,
      },
    })
  }

  private reject(args: {
    peer: Peer
    code: ECloseCode
    errorKind: EDaemonErrorKind
    message: string
  }): void {
    this.error(args)
    args.peer.live = false
    args.peer.connection.close({ code: args.code, reason: args.message })
  }

  private receive(args: { peer: Peer; text: string }): void {
    const { peer } = args
    if (!peer.live) return
    const frame = this.parse(args)
    if (frame === null) return
    if (frame.kind === 'hello') {
      this.hello({ peer, frame })
      return
    }
    if (peer.epoch === null) {
      this.error({ peer, errorKind: EDaemonErrorKind.Unauthenticated, message: 'hello first' })
      return
    }
    if (frame.kind === 'ping') {
      this.send({ peer, frame: { kind: 'pong', runs: this.ledger.runCount() } })
      return
    }
    if (frame.epoch !== peer.epoch) {
      this.error({
        peer,
        key: frame.key,
        errorKind: EDaemonErrorKind.InvalidFrame,
        message: `frame epoch ${frame.epoch} differs from the hello epoch ${peer.epoch}`,
      })
      return
    }
    void this.call({ peer, frame }).catch((error: unknown) => {
      this.args.onFault({ key: frame.key, error })
      this.error({
        peer,
        key: frame.key,
        errorKind: EDaemonErrorKind.Internal,
        message: 'internal error',
      })
    })
  }

  private parse(args: { peer: Peer; text: string }): HostFrame | null {
    let json: unknown
    try {
      json = JSON.parse(args.text)
    } catch {
      this.error({
        peer: args.peer,
        errorKind: EDaemonErrorKind.InvalidFrame,
        message: 'invalid json',
      })
      return null
    }
    const parsed = hostFrameSchema.safeParse(json)
    if (parsed.success) return parsed.data
    this.error({
      peer: args.peer,
      errorKind: EDaemonErrorKind.InvalidFrame,
      message: parsed.error.message,
    })
    return null
  }

  private hello(args: { peer: Peer; frame: Extract<HostFrame, { kind: 'hello' }> }): void {
    const { peer, frame } = args
    const tokenOk = daemonTokenMatches({
      secret: this.args.secret,
      sandboxName: this.args.sandboxName,
      token: frame.token,
    })
    if (!tokenOk) {
      this.reject({
        peer,
        code: ECloseCode.Unauthenticated,
        errorKind: EDaemonErrorKind.Unauthenticated,
        message: 'bad token',
      })
      return
    }
    const accepted = this.ledger.hello({ epoch: frame.epoch })
    if (!accepted.ok) {
      this.reject({
        peer,
        code: ECloseCode.Superseded,
        errorKind: accepted.errorKind,
        message: accepted.message,
      })
      return
    }
    const previous = this.current
    if (previous !== null && previous !== peer) {
      this.ledger.detachOwner({ owner: previous })
      this.reject({
        peer: previous,
        code: ECloseCode.Superseded,
        errorKind: EDaemonErrorKind.StaleEpoch,
        message: 'superseded',
      })
      for (const group of this.groups) group.onDisconnect?.()
    }
    peer.epoch = frame.epoch
    this.current = peer
    this.send({
      peer,
      frame: { kind: 'hello-reply', bootId: this.args.bootId, version: this.args.version },
    })
    this.send({
      peer,
      frame: {
        kind: 'health',
        bootId: this.args.bootId,
        version: this.args.version,
        ...this.args.health(),
      },
    })
    for (const group of this.groups) group.onConnect?.({ epoch: frame.epoch })
  }

  private async call(args: {
    peer: Peer
    frame: Exclude<HostFrame, { kind: 'hello' } | { kind: 'ping' }>
  }): Promise<void> {
    const { peer, frame } = args
    const outcome = await this.dispatch({ peer, frame })
    if (outcome.ok) {
      if (frame.kind === 'ack') this.send({ peer, frame: { kind: 'acked', key: frame.key } })
      return
    }
    this.error({ peer, key: frame.key, errorKind: outcome.errorKind, message: outcome.message })
  }

  private dispatch(args: {
    peer: Peer
    frame: Exclude<HostFrame, { kind: 'hello' } | { kind: 'ping' }>
  }): Promise<LedgerOutcome> {
    const { peer, frame } = args
    if (frame.kind === 'ack') return this.ledger.ack({ key: frame.key, epoch: frame.epoch })
    if (frame.kind === 'cancel') return this.ledger.cancel({ key: frame.key, epoch: frame.epoch })
    return this.ledger.run({
      key: frame.key,
      epoch: frame.epoch,
      op: frame.op,
      owner: peer,
      fromOffset: frame.fromOffset ?? 0,
      onReply: (state) => this.send({ peer, frame: { kind: 'run-reply', key: frame.key, state } }),
      sink: {
        output: ({ offset, bytes }) =>
          this.send({
            peer,
            frame: {
              kind: 'output',
              key: frame.key,
              offset,
              bytes: Buffer.from(bytes).toString('base64'),
            },
          }),
        result: ({ result }) =>
          this.send({ peer, frame: { kind: 'result', key: frame.key, result } }),
      },
    })
  }

  private disconnect(peer: Peer): void {
    peer.live = false
    this.ledger.detachOwner({ owner: peer })
    if (this.current !== peer) return
    this.current = null
    for (const group of this.groups) group.onDisconnect?.()
  }
}
