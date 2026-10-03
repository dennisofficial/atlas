import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { attachDurableShell, inspectDurableShell, STATUS_FILE, SPOOL_FILE } from '../client'
import { collect, isAlive, launcherScript, readUntil, scratchDirectory } from './fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function launchInOtherProcess({ shellDir, command }: { shellDir: string; command: string }): Promise<number> {
  const launcher = Bun.spawn([process.execPath, launcherScript, shellDir, command], { stdout: 'pipe', stderr: 'inherit' })
  const [out, status] = await Promise.all([new Response(launcher.stdout).text(), launcher.exited])
  expect(status).toBe(0)
  return (JSON.parse(out.trim()) as { pid: number }).pid
}

describe('durable shell survives its launcher', () => {
  test('reconnects after the launching process died: output, input and exact exit', async () => {
    const scratch = await scratchDirectory()
    cleanups.push(scratch.cleanup)
    const pid = await launchInOtherProcess({
      shellDir: scratch.shellDir,
      command: 'echo ready; read line; echo "got:$line"; exit 7',
    })
    expect(isAlive({ pid })).toBe(true)

    const attached = await attachDurableShell({ shellDir: scratch.shellDir, pollMs: 20 })
    if (!attached.ok) throw new Error(attached.reason)
    const { handle } = attached
    expect(handle.pid).toBe(pid)

    const first = await readUntil({ stream: handle.stdout, pattern: 'ready' })
    expect(first.text).toContain('ready')
    expect((await handle.writeInput('hello\n')).ok).toBe(true)

    const rest = new Promise<string>(async (resolve) => {
      let text = ''
      for (;;) {
        const { done, value } = await first.reader.read()
        if (done) return resolve(text)
        text += new TextDecoder().decode(value)
      }
    })
    expect(await handle.exited).toBe(7)
    expect(await rest).toContain('got:hello')
    const settled = await handle.settled
    expect(settled.kind).toBe('exited')
    await handle.detach()
    expect(isAlive({ pid })).toBe(false)
  })

  test('a shell that finished while nobody was attached reports its exact exit and full output', async () => {
    const scratch = await scratchDirectory()
    cleanups.push(scratch.cleanup)
    await launchInOtherProcess({ shellDir: scratch.shellDir, command: 'echo one; echo two >&2; exit 3' })

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = JSON.parse(await readFile(join(scratch.shellDir, STATUS_FILE), 'utf8')) as { phase: string }
      if (status.phase === 'exited') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const inspection = await inspectDurableShell({ shellDir: scratch.shellDir })
    expect(inspection.supervisorLive).toBe(false)
    expect(inspection.status?.exit?.exitCode).toBe(3)

    const attached = await attachDurableShell({ shellDir: scratch.shellDir, pollMs: 20 })
    if (!attached.ok) throw new Error(attached.reason)
    expect(await collect({ stream: attached.handle.stdout })).toBe('one\ntwo\n')
    expect(await attached.handle.exited).toBe(3)
    expect((await stat(join(scratch.shellDir, SPOOL_FILE))).mode & 0o777).toBe(0o600)
    expect((await attached.handle.writeInput('late\n')).ok).toBe(false)
  })

  test('a cursor resumes output without rereading what was already seen', async () => {
    const scratch = await scratchDirectory()
    cleanups.push(scratch.cleanup)
    await launchInOtherProcess({ shellDir: scratch.shellDir, command: 'echo abcdef' })
    const attached = await attachDurableShell({ shellDir: scratch.shellDir, cursor: 3, pollMs: 20 })
    if (!attached.ok) throw new Error(attached.reason)
    expect(await collect({ stream: attached.handle.stdout })).toBe('def\n')
  })
})
