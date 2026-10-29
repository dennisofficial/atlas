import { createHmac } from 'node:crypto'

const HOST_PORT_BASE = 20_000

// macOS hands out ephemeral ports from 49152 up, so derived ports stay under it to avoid
// colliding with the OS's own assignments.
const HOST_PORT_SPAN = 49_152 - HOST_PORT_BASE

export function derivedHostPort(args: { session: string; containerPort: number }): number {
  const digest = createHmac('sha256', 'atlas-port-exposure')
    .update(`${args.session}\n${args.containerPort}`)
    .digest()
  return HOST_PORT_BASE + (digest.readUInt32BE(0) % HOST_PORT_SPAN)
}

const listen = (port: number): Bun.TCPSocketListener =>
  Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } })

const hostPortFree = (port: number): boolean => {
  try {
    listen(port).stop(true)
    return true
  } catch {
    return false
  }
}

const ephemeralHostPort = (): number => {
  const listener = listen(0)
  const port = listener.port
  listener.stop(true)
  return port
}

export function hostPortFor(args: { session: string; containerPort: number }): number {
  const derived = derivedHostPort(args)
  return hostPortFree(derived) ? derived : ephemeralHostPort()
}
