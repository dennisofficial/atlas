import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const HOST_PORT_FILE = 'host-port'

const MAX_PORT = 65_535

export function readHostPort(home: string): number | undefined {
  try {
    const port = Number(readFileSync(join(home, HOST_PORT_FILE), 'utf8').trim())
    return Number.isInteger(port) && port > 0 && port <= MAX_PORT ? port : undefined
  } catch {
    return undefined
  }
}

function writeHostPort(args: { home: string; port: number }): void {
  try {
    mkdirSync(args.home, { recursive: true })
    writeFileSync(join(args.home, HOST_PORT_FILE), String(args.port))
  } catch {}
}

export function startOnStablePort<T extends { port: number }>(args: {
  home: string
  start: (port: number) => T
}): T {
  const remembered = readHostPort(args.home)
  const started = startOrAnyPort({ remembered, start: args.start })
  if (started.port !== remembered) writeHostPort({ home: args.home, port: started.port })
  return started
}

function startOrAnyPort<T>(args: {
  remembered: number | undefined
  start: (port: number) => T
}): T {
  if (args.remembered === undefined) return args.start(0)
  try {
    return args.start(args.remembered)
  } catch {
    return args.start(0)
  }
}
