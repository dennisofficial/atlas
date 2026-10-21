import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Sandbox } from '@vercel/sandbox'

import { ERuntimePhase, SANDBOX_HOME_PATH, SERVE_TOKEN_PATH } from '@dltech/atlas-wire'
import { drainServe } from '../serve-drain-client'
import { RUNTIME_CHECKPOINT_RELATIVE_PATH } from '../runtime-checkpoint'
import { rotationReceipt } from './rotation-fixture'

const fixture = async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-rotation-transport-'))
  const tokenFile = join(home, 'token')
  await writeFile(tokenFile, 'test-only-token')
  const sandbox = {
    currentSession: () => ({ sessionId: 'session-1' }),
    runCommand: async (args: { args: string[] }) => {
      const script = (args.args[1] ?? '')
        .replaceAll(SERVE_TOKEN_PATH, tokenFile)
        .replaceAll(SANDBOX_HOME_PATH, home)
      const process = Bun.spawn(['sh', '-c', script], { stdout: 'pipe', stderr: 'pipe' })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
      ])
      return { exitCode, stdout: async () => stdout, stderr: async () => stderr }
    },
  } as unknown as Sandbox
  const persistRecord = async (receipt: ReturnType<typeof rotationReceipt>): Promise<void> => {
    const file = join(home, RUNTIME_CHECKPOINT_RELATIVE_PATH)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ ...receipt.checkpoint, phase: ERuntimePhase.Updating, receipt }))
  }
  return { home, sandbox, persistRecord, close: () => rm(home, { recursive: true, force: true }) }
}

describe('rotation preparation over real HTTP and curl', () => {
  it('validates the HTTP body against the atomically persisted lifecycle record and recovers after a lost connection', async () => {
    const test = await fixture()
    let requests = 0
    const observed: { authorization: string | null; body: unknown }[] = []
    const receipt = rotationReceipt()
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests += 1
        observed.push({ authorization: request.headers.get('authorization'), body: await request.json() })
        await test.persistRecord(receipt)
        return Response.json({ ok: true, prepared: true, receipt })
      },
    })
    const url = `http://127.0.0.1:${server.port}`
    try {
      await drainServe({ sandbox: test.sandbox, url })
      await server.stop(true)
      await drainServe({ sandbox: test.sandbox, url })
      expect(requests).toBe(1)
      expect(observed).toEqual([{ authorization: 'Bearer test-only-token', body: { reason: 'cloud sandbox update' } }])
    } finally {
      await server.stop(true)
      await test.close()
    }
  })

  it('refuses a legacy 200 response that has no saved receipt in the lifecycle record', async () => {
    const test = await fixture()
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true, paused: true }) })
    try {
      await expect(drainServe({ sandbox: test.sandbox, url: `http://127.0.0.1:${server.port}` })).rejects.toThrow()
    } finally {
      await server.stop(true)
      await test.close()
    }
  })
})
