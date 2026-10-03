import { afterEach, describe, expect, test } from 'bun:test'
import { connect } from 'node:net'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  attachDurableShell,
  EControlError,
  ELeaseMode,
  EExitCause,
  inspectDurableShell,
  sendControl,
  SOCKET_FILE,
  TOKEN_FILE,
  type ControlResult,
} from '../client'
import { runShellSupervisor } from '../supervisor'
import { collect, isAlive, launchOrThrow, readUntil, scratchDirectory } from './fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function scratch(): Promise<string> {
  const made = await scratchDirectory()
  cleanups.push(made.cleanup)
  return made.shellDir
}

async function captureStdout({ run }: { run: () => Promise<number> }): Promise<{ code: number; out: string }> {
  const original = process.stdout.write.bind(process.stdout)
  let out = ''
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    out += String(chunk)
    return true
  }) as typeof process.stdout.write
  try {
    return { code: await run(), out }
  } finally {
    process.stdout.write = original
  }
}

describe('control socket', () => {
  test('private files are mode 0600 and the shell directory 0700', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    expect((await stat(shellDir)).mode & 0o777).toBe(0o700)
    expect((await stat(join(shellDir, TOKEN_FILE))).mode & 0o777).toBe(0o600)
    handle.terminate()
    await handle.exited
  })

  test('a connection with a wrong token or wrong identity is rejected and cannot act', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    const meta = (await inspectDurableShell({ shellDir })).meta
    if (meta === undefined) throw new Error('no meta')

    const reply = await new Promise<string>((resolve) => {
      const socket = connect(meta.socketPath)
      let data = ''
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ type: 'hello', id: 1, token: 'wrong', identity: meta.identity })}\n`)
        socket.write(`${JSON.stringify({ type: 'kill', id: 2 })}\n`)
      })
      socket.on('data', (chunk) => (data += chunk.toString()))
      socket.on('close', () => resolve(data))
    })
    expect(reply).toContain('unauthorized')
    expect(isAlive({ pid: handle.pid })).toBe(true)

    handle.terminate()
    await handle.exited
  })

  test('sendControl authenticates, delivers input, and reports probe from the target namespace', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'read line; echo "echo:$line"' })
    const probe = await sendControl({ directory: shellDir, request: { type: 'probe' } })
    expect(probe).toEqual({ ok: true, probe: { supervisorAlive: true, childAlive: true, reachable: true } })

    const sent = await sendControl({
      directory: shellDir,
      request: { type: 'input', dataBase64: Buffer.from('ping\n').toString('base64') },
    })
    expect(sent.ok).toBe(true)
    expect(await collect({ stream: handle.stdout })).toBe('echo:ping\n')
    expect(await handle.exited).toBe(0)

    const late = await sendControl({ directory: shellDir, request: { type: 'kill' } })
    expect(late.ok).toBe(false)
  })

  test('sendControl against a missing shell fails without hanging', async () => {
    const shellDir = await scratch()
    const result = await sendControl({ directory: shellDir, request: { type: 'terminate' } })
    expect(result.ok).toBe(false)
  })

  test('the one-shot --control entry prints one JSON ControlResult line', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'cat' })
    const { code, out } = await captureStdout({
      run: () =>
        runShellSupervisor(['--control', shellDir, JSON.stringify({ type: 'input', dataBase64: Buffer.from('hi\n').toString('base64') })]),
    })
    expect(code).toBe(0)
    expect(JSON.parse(out.trim())).toEqual({ ok: true })
    await runShellSupervisor(['--control', shellDir, JSON.stringify({ type: 'closeInput' })]).catch(() => 2)
    expect(await collect({ stream: handle.stdout })).toBe('hi\n')

    expect((await captureStdout({ run: () => runShellSupervisor(['--control', shellDir, 'not json']) })).code).toBe(2)
    expect((await captureStdout({ run: () => runShellSupervisor([]) })).code).toBe(2)
  })

  test('the --control entry run as a real process works end to end', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    const entry = join(import.meta.dir, '..', 'supervisor-main.ts')
    const child = Bun.spawn([process.execPath, entry, '--control', shellDir, JSON.stringify({ type: 'terminate' })], {
      stdout: 'pipe',
    })
    const [out, status] = await Promise.all([new Response(child.stdout).text(), child.exited])
    expect(status).toBe(0)
    expect(JSON.parse(out.trim())).toEqual({ ok: true })
    expect(await handle.exited).toBe(143)
  })
})

describe('transport and file lease', () => {
  test('a custom transport carries every control call and a file lease keeps the shell alive', async () => {
    const shellDir = await scratch()
    const first = await launchOrThrow({ shellDir, ttlMs: 600, tickMs: 50, leaseMs: 150, command: 'cat' })
    await first.detach()

    const calls: string[] = []
    const attached = await attachDurableShell({
      shellDir,
      pollMs: 20,
      leaseMode: ELeaseMode.File,
      transport: async ({ request }): Promise<ControlResult> => {
        calls.push(request.type)
        if (request.type === 'probe') return { ok: true, probe: { supervisorAlive: true, childAlive: true, reachable: true } }
        return sendControl({ directory: shellDir, request })
      },
    })
    if (!attached.ok) throw new Error(attached.reason)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(isAlive({ pid: attached.handle.pid })).toBe(true)
    expect((await attached.handle.writeInput('x\n')).ok).toBe(true)
    await attached.handle.closeInput()
    expect(await attached.handle.exited).toBe(0)
    expect(calls).toContain('input')
  })

  test('without any lease the same shell expires', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, ttlMs: 400, tickMs: 50, leaseMs: 150, command: 'cat' })
    await handle.detach()
    const again = await attachDurableShell({ shellDir, pollMs: 20, leaseMode: ELeaseMode.File, transport: ({ request }) => sendControl({ directory: shellDir, request }) })
    if (!again.ok) throw new Error(again.reason)
    await again.handle.detach()
    const settled = await Promise.race([
      (async () => {
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const exit = (await inspectDurableShell({ shellDir })).status?.exit
          if (exit !== undefined) return exit
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        return undefined
      })(),
    ])
    expect(settled?.cause).toBe(EExitCause.Expired)
  })
})

describe('refusal codes', () => {
  test('unreachable socket maps to the unreachable code', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'true' })
    await handle.exited
    const result = await sendControl({ directory: shellDir, request: { type: 'heartbeat' } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect([EControlError.Unreachable, EControlError.Timeout]).toContain(result.code)
    expect(SOCKET_FILE).toBe('control.sock')
    await readUntil({ stream: handle.stdout, pattern: '' })
  })
})
