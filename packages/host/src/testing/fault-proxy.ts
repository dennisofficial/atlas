import type { Socket } from 'bun'

export type ProxyFault =
  | { latencyMs: number; jitterMs?: number | undefined }
  | { bytesPerSecond: number }
  | { blackhole: true }
  | { refuse: true }
  | { holdUpstream: true }

export type FaultProxy = {
  port: number
  set(fault: ProxyFault): void
  clear(): void
  drop(): void
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
  closed: boolean
}

const newRelay = (client: RelaySocket): Relay => ({
  client,
  target: undefined,
  buffers: { upstream: [], downstream: [] },
  writing: { upstream: false, downstream: false },
  closed: false,
})

type State = {
  fault: ProxyFault | undefined
  relays: Set<Relay>
  target: { host: string; port: number }
}

const latencyOf = (fault: ProxyFault | undefined): number => {
  if (fault === undefined || !('latencyMs' in fault)) return 0
  const jitter = fault.jitterMs ?? 0
  return fault.latencyMs + (jitter > 0 ? Math.random() * jitter : 0)
}

const writeChunk = (socket: RelaySocket, chunk: Uint8Array): void => {
  const written = socket.write(chunk)
  if (written < chunk.byteLength) socket.write(chunk.subarray(written))
}

const destinationOf = (relay: Relay, direction: Direction): RelaySocket | undefined =>
  direction === 'upstream' ? relay.target : relay.client

const flush = (state: State, relay: Relay, direction: Direction): void => {
  const destination = destinationOf(relay, direction)
  if (destination === undefined || relay.closed || relay.writing[direction]) return
  const queue = relay.buffers[direction]
  const chunk = queue.shift()
  if (chunk === undefined) return
  const fault = state.fault
  const latency = latencyOf(fault)
  const throttle = fault !== undefined && 'bytesPerSecond' in fault ? fault : undefined
  const send = (): void => {
    relay.writing[direction] = false
    if (relay.closed) return
    if (state.fault !== undefined && 'blackhole' in state.fault) {
      flush(state, relay, direction)
      return
    }
    if (throttle !== undefined && direction === 'downstream') {
      const slice = chunk.subarray(0, Math.max(1, Math.floor(throttle.bytesPerSecond / 10)))
      writeChunk(destination, slice)
      const rest = chunk.subarray(slice.byteLength)
      if (rest.byteLength > 0) queue.unshift(rest)
      relay.writing[direction] = true
      setTimeout(() => {
        relay.writing[direction] = false
        flush(state, relay, direction)
      }, 100)
      return
    }
    writeChunk(destination, chunk)
    flush(state, relay, direction)
  }
  relay.writing[direction] = true
  if (latency > 0) setTimeout(send, latency)
  else send()
}

const receive = (state: State, relay: Relay, direction: Direction, chunk: Uint8Array): void => {
  const fault = state.fault
  if (fault !== undefined) {
    if ('blackhole' in fault) return
    if (direction === 'upstream' && 'holdUpstream' in fault) {
      relay.buffers.upstream.push(new Uint8Array(chunk))
      return
    }
  }
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
    const state: State = { fault: undefined, relays: new Set(), target: args.target }

    const openUpstream = (relay: Relay): void => {
      Bun.connect<Relay>({
        hostname: state.target.host,
        port: state.target.port,
        socket: {
          open(target) {
            target.data = relay
            relay.target = target
            flush(state, relay, 'upstream')
          },
          data(target, chunk) {
            receive(state, target.data, 'downstream', chunk)
          },
          close(target) {
            closeRelay(state, target.data, true)
          },
          error(target) {
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
          if (state.fault !== undefined && 'refuse' in state.fault) {
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
        const held = state.fault !== undefined && 'holdUpstream' in state.fault
        state.fault = undefined
        if (held) {
          for (const relay of state.relays) flush(state, relay, 'upstream')
        }
      },
      drop() {
        for (const relay of [...state.relays]) closeRelay(state, relay, false)
      },
      connections: () => state.relays.size,
      async stop() {
        for (const relay of [...state.relays]) closeRelay(state, relay, false)
        server.stop(true)
      },
    }
  },
}
