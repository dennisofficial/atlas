import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SERVE_ALIVE_PROBE } from '../sandbox-serve-launch.js'
import { SERVE_BINARY_PATH, SERVE_HOME } from '../serve-env.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const probeAgainst = async (processes: Record<string, string>): Promise<number> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-alive-probe-'))
  roots.push(root)
  const proc = join(root, 'proc')
  for (const [pid, cmdline] of Object.entries(processes)) {
    await mkdir(join(proc, pid), { recursive: true })
    await writeFile(join(proc, pid, 'cmdline'), cmdline)
  }
  const script = SERVE_ALIVE_PROBE.replaceAll(
    `${SERVE_HOME}/atlas-serve.pid`,
    join(root, 'no.pid'),
  ).replaceAll('/proc/', `${proc}/`)
  const child = Bun.spawn(['sh', '-c', script], { stdout: 'ignore', stderr: 'ignore' })
  return child.exited
}

describe('SERVE_ALIVE_PROBE without a live pid file', () => {
  it('finds serve proper, which runs the binary with no arguments', async () => {
    expect(await probeAgainst({ '101': `${SERVE_BINARY_PATH}\0` })).toBe(0)
  })

  it('ignores the background-shell supervisor running the same binary', async () => {
    expect(
      await probeAgainst({ '102': `${SERVE_BINARY_PATH}\0--shell-supervise\0--state\0/tmp/x\0` }),
    ).toBe(1)
  })

  it('still finds serve when a supervisor is also running', async () => {
    expect(
      await probeAgainst({
        '102': `${SERVE_BINARY_PATH}\0--shell-supervise\0`,
        '103': `${SERVE_BINARY_PATH}\0`,
      }),
    ).toBe(0)
  })

  it('ignores other processes', async () => {
    expect(await probeAgainst({ '104': '/bin/sh\0-c\0sleep 100\0' })).toBe(1)
  })
})
