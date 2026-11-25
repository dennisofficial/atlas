import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const HOST_PORT_FILE = 'host-port'
export const HOST_TLS_PORT_FILE = 'host-tls-port'

const MAX_PORT = 65_535

export function readPort({ home, file }: { home: string; file: string }): number | undefined {
  try {
    const port = Number(readFileSync(join(home, file), 'utf8').trim())
    return Number.isInteger(port) && port > 0 && port <= MAX_PORT ? port : undefined
  } catch {
    return undefined
  }
}

export function readHostPort(home: string): number | undefined {
  return readPort({ home, file: HOST_PORT_FILE })
}

function writePort({ home, file, port }: { home: string; file: string; port: number }): void {
  try {
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, file), String(port))
  } catch {}
}

export function startOnStablePort<T extends { port: number | undefined }>(args: {
  home: string
  start: (port: number) => T
}): T {
  const remembered = readPort({ home: args.home, file: HOST_PORT_FILE })
  const started = startOrAnyPort({ remembered, start: args.start })
  if (started.port !== undefined && started.port !== remembered)
    writePort({ home: args.home, file: HOST_PORT_FILE, port: started.port })
  return started
}

export async function startOnStablePortAsync<T extends { port: number }>(args: {
  home: string
  file: string
  start: (port: number) => Promise<T>
}): Promise<T> {
  const remembered = readPort({ home: args.home, file: args.file })
  const started = await startOrAnyPortAsync({ remembered, start: args.start })
  if (started.port !== remembered)
    writePort({ home: args.home, file: args.file, port: started.port })
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

async function startOrAnyPortAsync<T>(args: {
  remembered: number | undefined
  start: (port: number) => Promise<T>
}): Promise<T> {
  if (args.remembered === undefined) return args.start(0)
  try {
    return await args.start(args.remembered)
  } catch {
    return args.start(0)
  }
}
