import type { Socket } from 'bun'

export type ProxyFault =
  | { latencyMs: number; jitterMs?: number | undefined }
  | { bytesPerSecond: number }
  | { blackhole: true }
  | { refuse: true }
  | { holdUpstream: true }
  | { holdDownstream: true }

export type FaultProxy = {
  port: number
  set(fault: ProxyFault): void
  clear(): void
  drop(): void
  retarget(target: { host: string; port: number }): void
  connections(): number
  stop(): Promise<void>
}

type RelaySocket = Socket<Relay>

type Direction = 'upstream' | 'downstream'

type Relay = {
  client: RelaySocket | undefined
  target: RelaySocket | undefined
  buffers: Record<Direction, Uint8Array[]>
  writing: Record<Direction, boolean>
  pausedOn: Record<Direction, RelaySocket | undefined>
  closed: boolean
}

const newRelay = (client: RelaySocket): Relay => ({
  client,
  target: undefined,
  buffers: { upstream: [], downstream: [] },
  writing: { upstream: false, downstream: false },
  pausedOn: { upstream: undefined, downstream: undefined },
  closed: false,
})

type State = {
  fault: ProxyFault | undefined
  relays: Set<Relay>
  target: { host: string; port: number }
  stopped: boolean
}

const latencyOf = (fault: ProxyFault | undefined): number => {
  if (fault === undefined || !('latencyMs' in fault)) return 0
  const jitter = fault.jitterMs ?? 0
  return fault.latencyMs + (jitter > 0 ? Math.random() * jitter : 0)
}

const isHeldUpstream = (fault: ProxyFault | undefined): boolean =>
  fault !== undefined && 'holdUpstream' in fault

const isHeldDownstream = (fault: ProxyFault | undefined): boolean =>
  fault !== undefined && 'holdDownstream' in fault

const isBlackholed = (fault: ProxyFault | undefined): boolean =>
  fault !== undefined && 'blackhole' in fault

const destinationOf = (relay: Relay, direction: Direction): RelaySocket | undefined =>
  direction === 'upstream' ? relay.target : relay.client

const flush = (state: State, relay: Relay, direction: Direction): void => {
  const destination = destinationOf(relay, direction)
  if (destination === undefined || relay.closed) return
  if (relay.writing[direction] || relay.pausedOn[direction] !== undefined) return
  if (direction === 'upstream' && isHeldUpstream(state.fault)) return
  if (direction === 'downstream' && isHeldDownstream(state.fault)) return
  const queue = relay.buffers[direction]
  const chunk = queue.shift()
  if (chunk === undefined) return
  if (isBlackholed(state.fault)) {
    queue.length = 0
    return
  }
  const latency = latencyOf(state.fault)
  const throttle =
    state.fault !== undefined && 'bytesPerSecond' in state.fault ? state.fault : undefined
  const send = (): void => {
    relay.writing[direction] = false
    if (relay.closed || state.stopped) return
    if (direction === 'upstream' && isHeldUpstream(state.fault)) {
      queue.unshift(chunk)
      return
    }
    if (direction === 'downstream' && isHeldDownstream(state.fault)) {
      queue.unshift(chunk)
      return
    }
    if (isBlackholed(state.fault)) {
      queue.length = 0
      return
    }
    let part = chunk
    if (throttle !== undefined && direction === 'downstream') {
      const budget = Math.max(1, Math.floor(throttle.bytesPerSecond / 10))
      const parts = [chunk]
      let gathered = chunk.byteLength
      while (gathered < budget) {
        const next = queue.shift()
        if (next === undefined) break
        parts.push(next)
        gathered += next.byteLength
      }
      if (parts.length > 1) {
        const joined = new Uint8Array(gathered)
        let offset = 0
        for (const piece of parts) {
          joined.set(piece, offset)
          offset += piece.byteLength
        }
        part = joined
      }
      if (part.byteLength > budget) {
        queue.unshift(part.subarray(budget))
        part = part.subarray(0, budget)
      }
    }
    const written = destination.write(part)
    if (written < part.byteLength) {
      queue.unshift(part.subarray(written))
      relay.pausedOn[direction] = destination
      return
    }
    if (throttle !== undefined && direction === 'downstream' && queue.length > 0) {
      relay.writing[direction] = true
      setTimeout(() => {
        relay.writing[direction] = false
        flush(state, relay, direction)
      }, 100)
      return
    }
    flush(state, relay, direction)
  }
  relay.writing[direction] = true
  if (latency > 0) setTimeout(send, latency)
  else send()
}

const receive = (state: State, relay: Relay, direction: Direction, chunk: Uint8Array): void => {
  if (isBlackholed(state.fault)) return
  relay.buffers[direction].push(new Uint8Array(chunk))
  flush(state, relay, direction)
}

const closeRelay = (state: State, relay: Relay, withFin: boolean): void => {
  if (relay.closed) return
  relay.closed = true
  state.relays.delete(relay)
  for (const socket of [relay.client, relay.target]) {
    if (socket === undefined) continue
    try {
      if (withFin) socket.end()
      else socket.close()
    } catch {
      // the socket is already gone
    }
  }
  relay.client = undefined
  relay.target = undefined
}

export const FaultProxy = {
  start: async (args: { target: { host: string; port: number } }): Promise<FaultProxy> => {
    const state: State = {
      fault: undefined,
      relays: new Set(),
      target: args.target,
      stopped: false,
    }

    const handleDrain = (socket: RelaySocket): void => {
      const relay = socket.data
      if (relay === undefined || relay.closed) return
      for (const direction of ['upstream', 'downstream'] as const) {
        if (relay.pausedOn[direction] !== socket) continue
        relay.pausedOn[direction] = undefined
        flush(state, relay, direction)
      }
    }

    const openUpstream = (relay: Relay): void => {
      Bun.connect<Relay>({
        hostname: state.target.host,
        port: state.target.port,
        socket: {
          open(target) {
            if (relay.closed || state.stopped) {
              try {
                target.close()
              } catch {
                // the socket is already gone
              }
              return
            }
            target.data = relay
            relay.target = target
            flush(state, relay, 'upstream')
          },
          data(target, chunk) {
            if (target.data === undefined) return
            receive(state, target.data, 'downstream', chunk)
          },
          drain(target) {
            handleDrain(target)
          },
          close(target) {
            if (target.data === undefined) return
            closeRelay(state, target.data, true)
          },
          error(target) {
            if (target.data === undefined) return
            closeRelay(state, target.data, false)
          },
        },
      }).catch(() => {
        closeRelay(state, relay, false)
      })
    }

    const server = Bun.listen<Relay>({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        open(client) {
          if (state.stopped || (state.fault !== undefined && 'refuse' in state.fault)) {
            client.end()
            return
          }
          const relay = newRelay(client)
          client.data = relay
          state.relays.add(relay)
          openUpstream(relay)
        },
        data(client, chunk) {
          if (client.data === undefined) return
          receive(state, client.data, 'upstream', chunk)
        },
        drain(client) {
          handleDrain(client)
        },
        close(client) {
          if (client.data === undefined) return
          closeRelay(state, client.data, true)
        },
        error(client) {
          if (client.data === undefined) return
          closeRelay(state, client.data, false)
        },
      },
    })

    return {
      port: server.port,
      set(fault) {
        if ('refuse' in fault) {
          for (const relay of [...state.relays]) closeRelay(state, relay, false)
        }
        state.fault = fault
      },
      clear() {
        const heldUpstream = isHeldUpstream(state.fault)
        const heldDownstream = isHeldDownstream(state.fault)
        state.fault = undefined
        for (const relay of state.relays) {
          if (heldUpstream) flush(state, relay, 'upstream')
          if (heldDownstream) flush(state, relay, 'downstream')
        }
      },
      drop() {
        for (const relay of [...state.relays]) closeRelay(state, relay, false)
      },
      retarget(target) {
        state.target = target
        for (const relay of [...state.relays]) closeRelay(state, relay, false)
      },
      connections: () => state.relays.size,
      async stop() {
        state.stopped = true
        for (const relay of [...state.relays]) closeRelay(state, relay, false)
        server.stop(true)
      },
    }
  },
}
