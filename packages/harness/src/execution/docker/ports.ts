import { createHmac } from 'node:crypto'

export type BoundPort = {
  containerPort: number
  hostPort: number
}

export type PortBinding = {
  HostIp: string
  HostPort: string
}

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

export function parseBoundPorts(value: unknown): BoundPort[] {
  if (typeof value !== 'object' || value === null) return []

  const ports: BoundPort[] = []
  for (const [key, bindings] of Object.entries(value)) {
    const containerPort = Number(key.split('/')[0])
    if (!Number.isInteger(containerPort) || !Array.isArray(bindings)) continue

    const first: unknown = bindings[0]
    if (typeof first !== 'object' || first === null) continue

    const hostPort = Number((first as { HostPort?: unknown }).HostPort)
    if (!Number.isInteger(hostPort)) continue

    ports.push({ containerPort, hostPort })
  }
  return ports
}
