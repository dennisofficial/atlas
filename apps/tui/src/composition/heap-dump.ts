import { createWriteStream } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { getHeapSnapshot } from 'node:v8'

import { atlasDirectory } from '@dltech/atlas-harness'

import { messageOf } from './error-text'

export const HEAPDUMPS_DIRECTORY_NAME = 'heapdumps'

export function heapdumpsDirectory(): string {
  return join(atlasDirectory(), HEAPDUMPS_DIRECTORY_NAME)
}

let inFlight: Promise<string> | null = null

export function writeHeapDump(args: { directory: string }): Promise<string> {
  if (inFlight !== null) return inFlight

  inFlight = dump(args).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function dump(args: { directory: string }): Promise<string> {
  await mkdir(args.directory, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const partial = join(args.directory, `${stamp}-pid${process.pid}.heapsnapshot.partial`)
  await pipeline(getHeapSnapshot(), createWriteStream(partial))

  const file = partial.slice(0, -'.partial'.length)
  await rename(partial, file)
  return file
}

export function installHeapDumpSignal(args: {
  directory?: string
  onDone: (args: { text: string; failed: boolean }) => void
}): void {
  process.on('SIGUSR2', () => {
    void writeHeapDump({ directory: args.directory ?? heapdumpsDirectory() }).then(
      (file) => args.onDone({ text: `Heap dump written to ${file}`, failed: false }),
      (error: unknown) =>
        args.onDone({ text: `Heap dump failed: ${messageOf(error)}`, failed: true }),
    )
  })
}
