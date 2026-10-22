import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { toThreadId, type ProcessHandle, type ProcessPort } from '@dltech/atlas-core'

import { LocalFileSystemPort } from '../../execution/local-filesystem'
import { LocalProcessPort } from '../../execution/local-process'
import { deliverOperatorInput } from '../deliver'

const VALUE = `  ${'hello 世界\r\n'.repeat(2000)}\nend  `
const THREAD = toThreadId('operator-delivery')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'atlas-opinput-'))
  const files = new LocalFileSystemPort()
  const processes = new LocalProcessPort()
  const path = join(root, 'input')
  const args = { files, processes, path, value: VALUE, threadId: THREAD, cwd: root, signal: new AbortController().signal }
  return { root, path, args, close: () => rm(root, { recursive: true }) }
}

function failingProcesses(args: { code: number; stderr: string }): ProcessPort {
  const stream = (text: string) => new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  const handle = (): ProcessHandle => ({ stdout: stream(''), stderr: stream(args.stderr), exited: Promise.resolve(args.code), terminate: () => undefined })
  return { spawn: handle, which: () => null }
}

describe('operator input destination', () => {
  it('preserves large multiline UTF-8 text exactly in a new private file', async () => {
    const { path, args, close } = await fixture()
    try {
      expect(await deliverOperatorInput(args)).toEqual({ ok: true, bytes: Buffer.byteLength(VALUE) })
      expect(await readFile(path, 'utf8')).toBe(VALUE)
      expect((await args.files.stat({ path })).mode & 0o777).toBe(0o600)
    } finally { await close() }
  })

  it('refuses to overwrite an existing regular file', async () => {
    const { path, args, close } = await fixture()
    try {
      await writeFile(path, 'original')
      const result = await deliverOperatorInput(args)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('already exists')
        expect(result.reason).toContain('never overwrites')
      }
      expect(await readFile(path, 'utf8')).toBe('original')
    } finally { await close() }
  })

  it('includes a short stderr tail in a no-clobber failure reason', async () => {
    const { args, close } = await fixture()
    try {
      const stderr = `sh: 1: cannot create ${args.path}: File exists`
      const result = await deliverOperatorInput({ ...args, processes: failingProcesses({ code: 2, stderr }) })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('already exists')
        expect(result.reason).toContain(stderr)
      }
    } finally { await close() }
  })

  it('includes the exit code and short stderr tail for other failures', async () => {
    const { args, close } = await fixture()
    try {
      const result = await deliverOperatorInput({ ...args, processes: failingProcesses({ code: 1, stderr: 'sh: 1: Permission denied\n' }) })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('exit 1')
        expect(result.reason).toContain('(sh: 1: Permission denied)')
        expect(result.reason).not.toContain('already exists')
      }
    } finally { await close() }
  })

  it('omits a long stderr from the failure reason', async () => {
    const { args, close } = await fixture()
    try {
      const stderr = 'x'.repeat(300)
      const result = await deliverOperatorInput({ ...args, processes: failingProcesses({ code: 1, stderr }) })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('exit 1')
        expect(result.reason).not.toContain(stderr)
      }
    } finally { await close() }
  })

  it('routes the spool and recipient process to the requesting thread and removes the spool', async () => {
    const { args, close } = await fixture()
    const writes: { path: string; content: string; threadId: unknown }[] = []
    const removals: string[] = []
    const streams = () => new ReadableStream<Uint8Array>({ start: (c) => c.close() })
    const handle: ProcessHandle = { stdout: streams(), stderr: streams(), exited: Promise.resolve(0), terminate: () => undefined }
    const spawns: unknown[] = []
    const processes: ProcessPort = { spawn: (command) => { spawns.push(command); return handle }, which: () => null }
    try {
      const files = args.files
      files.writeFile = async (input) => { writes.push({ ...input, threadId: Reflect.get(input, 'threadId') }) }
      files.removeFile = async (input) => { removals.push(input.path) }
      expect((await deliverOperatorInput({ ...args, files, processes })).ok).toBe(true)
      expect(writes[0]).toMatchObject({ content: VALUE, threadId: THREAD })
      expect(spawns[0]).toMatchObject({ threadId: THREAD, cwd: args.cwd })
      expect(JSON.stringify(spawns)).not.toContain('hello')
      expect(removals).toHaveLength(1)
      expect(removals[0]).toBe(writes[0]?.path)
    } finally { await close() }
  })

  it('writes to a real FIFO reader and removes its temporary staging file', async () => {
    const { path, args, close } = await fixture()
    let reader: ReturnType<typeof Bun.spawn> | undefined
    try {
      const mkfifo = Bun.spawn(['mkfifo', path])
      expect(await mkfifo.exited).toBe(0)
      const child = Bun.spawn(['cat', path], { stdout: 'pipe', stderr: 'pipe' })
      reader = child
      const output = new Response(child.stdout).text()
      expect(await deliverOperatorInput(args)).toEqual({ ok: true, bytes: Buffer.byteLength(VALUE) })
      expect(await output).toBe(VALUE)
      expect(await reader.exited).toBe(0)
    } finally {
      reader?.kill()
      await close()
    }
  })

  it('terminates a FIFO write that has no reader on timeout', async () => {
    const { path, args, close } = await fixture()
    try {
      expect(await Bun.spawn(['mkfifo', path]).exited).toBe(0)
      const result = await deliverOperatorInput({ ...args, timeoutMs: 50 })
      expect(result).toMatchObject({ ok: false })
      if (!result.ok) expect(result.reason).toContain('timed out')
    } finally { await close() }
  })

  it('honors an interrupt during a blocked FIFO write', async () => {
    const { path, args, close } = await fixture()
    const controller = new AbortController()
    try {
      expect(await Bun.spawn(['mkfifo', path]).exited).toBe(0)
      const delivering = deliverOperatorInput({ ...args, signal: controller.signal })
      const abort = setTimeout(() => controller.abort(), 50)
      expect(await delivering).toMatchObject({ ok: false })
      const result = await delivering
      if (!result.ok) expect(result.reason).toContain('partial input may have reached the reader')
      clearTimeout(abort)
    } finally { await close() }
  })
})
