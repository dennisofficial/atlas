import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ArchiveUploadSandbox } from '../workspace-archive-transport'

export const CHUNK = 64

const roots: string[] = []

const scratch = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-archive-concurrency-'))
  roots.push(root)
  return root
}

export const removeScratchRoots = async (): Promise<void> => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
}

export const runShell = (script: string): Promise<number> =>
  new Promise((resolve) => {
    spawn('sh', ['-c', script]).on('close', (code) => resolve(code ?? 1))
  })

type PendingWrite = {
  path: string
  content: Uint8Array
  release: () => void
  fail: (error: Error) => void
}

export const gatedSandbox = () => {
  const started: PendingWrite[] = []
  const commands: string[] = []
  const waiters: { count: number; resolve: () => void }[] = []
  const rawBuffers = new Set<ArrayBufferLike>()
  let inFlight = 0
  let landed = 0
  let peak = 0
  const sandbox: ArchiveUploadSandbox = {
    writeFiles: async (files) => {
      for (const file of files) {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        rawBuffers.add(file.content.buffer)
        const gate = new Promise<void>((resolve, reject) => {
          started.push({ path: file.path, content: file.content, release: resolve, fail: reject })
        })
        gate.catch(() => undefined)
        await mkdir(dirname(file.path), { recursive: true })
        await writeFile(file.path, file.content)
        landed += 1
        for (const waiter of waiters) if (landed >= waiter.count) waiter.resolve()
        try {
          await gate
        } finally {
          inFlight -= 1
        }
      }
    },
    runCommand: async ({ args }) => {
      const script = args[1] ?? ''
      commands.push(script)
      return { exitCode: await runShell(script) }
    },
  }
  const whenStarted = (count: number): Promise<void> =>
    landed >= count ? Promise.resolve() : new Promise((resolve) => waiters.push({ count, resolve }))
  return { sandbox, started, commands, rawBuffers, whenStarted, peak: () => peak }
}

export const quiesce = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}

export const releaseAll = async (args: { gate: ReturnType<typeof gatedSandbox>; total: number }): Promise<void> => {
  for (let index = 0; index < args.total; index += 1) {
    await args.gate.whenStarted(index + 1)
    args.gate.started[index]?.release()
  }
}

export const patterned = (length: number): Buffer => Buffer.from(Array.from({ length }, (_, index) => index % 251))

export const prepare = async (length: number) => {
  const root = await scratch()
  const source = join(root, 'source.tar.gz')
  const bytes = patterned(length)
  await writeFile(source, bytes)
  const drive = join(root, 'drive')
  return { root, source, bytes, drive, destination: join(drive, 'workspace.tar.gz') }
}

export const completeInReverse = async (args: {
  gate: ReturnType<typeof gatedSandbox>
  waveSize: number
  waves: number
}): Promise<void> => {
  for (let wave = 0; wave < args.waves; wave += 1) {
    await args.gate.whenStarted(args.waveSize * (wave + 1))
    for (const write of args.gate.started.slice(wave * args.waveSize, (wave + 1) * args.waveSize).reverse()) {
      write.release()
    }
  }
}

