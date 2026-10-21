import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EServeArch, SERVE_HOME, type DevServeBinary } from '@dltech/atlas-wire'

import type { PodExecResult } from '../../../execution/docker/pod-engine'
import { boundedScript, shellQuoted, type PodServeEngine } from '../serve-exec'
import { devServeInstaller, podServeArchOf, releaseServeInstaller } from '../serve-install'

type Written = { id: string; path: string; content: Uint8Array | string; mode?: number | undefined }
type Exec = { id: string; script: string; timeoutMs: number }

const outcome = (args: { exitCode: number; stderr?: string }): PodExecResult => ({
  exitCode: args.exitCode,
  stdout: async () => '',
  stderr: async () => args.stderr ?? '',
})

const fakeEngine = (args?: { exitFor?: (script: string) => { exitCode: number; stderr?: string } }) => {
  const execs: Exec[] = []
  const writes: Written[] = []
  const engine: PodServeEngine = {
    async execSh(exec) {
      execs.push(exec)
      return outcome(args?.exitFor?.(exec.script) ?? { exitCode: 0 })
    },
    async writeFile(write) {
      writes.push(write)
    },
  }
  return { engine, execs, writes }
}

describe('boundedScript', () => {
  it('wraps the script in a guest timeout and gives the host deadline a margin', () => {
    expect(boundedScript({ script: 'echo hi', seconds: 30 })).toEqual({
      script: "timeout -k 5 30 sh -c 'echo hi'",
      timeoutMs: 45_000,
    })
  })

  it('escapes single quotes inside the script', () => {
    expect(shellQuoted("it's")).toBe(`'it'\\''s'`)
    expect(boundedScript({ script: "echo 'x'", seconds: 1 }).script).toBe(
      `timeout -k 5 1 sh -c 'echo '\\''x'\\'''`,
    )
  })
})

describe('podServeArchOf', () => {
  it('maps node architectures to serve builds', () => {
    expect(podServeArchOf('arm64')).toBe(EServeArch.Arm64)
    expect(podServeArchOf('x64')).toBe(EServeArch.X64)
  })

  it('defaults to the host architecture', () => {
    expect(podServeArchOf()).toBe(podServeArchOf(process.arch))
  })

  it('throws on anything else', () => {
    expect(() => podServeArchOf('ia32')).toThrow(/ia32/)
  })
})

describe('releaseServeInstaller', () => {
  it('runs the release install bounded to 300s inside the guest', async () => {
    const fake = fakeEngine()

    await releaseServeInstaller({ arch: EServeArch.Arm64 })({
      engine: fake.engine,
      id: 'pod-id',
      name: 'pod',
      version: '1.2.3',
    })

    expect(fake.execs).toHaveLength(1)
    const exec = fake.execs[0]!
    expect(exec.id).toBe('pod-id')
    expect(exec.timeoutMs).toBe(315_000)
    expect(exec.script.startsWith('timeout -k 5 300 sh -c ')).toBe(true)
    expect(exec.script).toContain(`mkdir -p ${SERVE_HOME}`)
    expect(exec.script).toContain('atlas-serve-linux-arm64')
    expect(exec.script).toContain('tui-v1.2.3')
  })

  it('surfaces stderr on a non-zero exit', async () => {
    const fake = fakeEngine({ exitFor: () => ({ exitCode: 22, stderr: 'curl: (22) 404\n' }) })

    await expect(
      releaseServeInstaller({ arch: EServeArch.X64 })({
        engine: fake.engine,
        id: 'pod-id',
        name: 'pod',
        version: undefined,
      }),
    ).rejects.toThrow(/exit 22.*curl: \(22\) 404/s)
  })

  it('wraps an exec that throws', async () => {
    const engine: PodServeEngine = {
      async execSh() {
        throw new Error('exec timed out after 315000ms')
      },
      async writeFile() {},
    }

    await expect(
      releaseServeInstaller({ arch: EServeArch.X64 })({ engine, id: 'pod-id', name: 'pod', version: undefined }),
    ).rejects.toThrow(/failed to run: exec timed out/)
  })
})

describe('devServeInstaller', () => {
  let directory = ''
  const content = new TextEncoder().encode('#!dev-serve-bytes')
  let binary: DevServeBinary

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pod-dev-serve-'))
    const path = join(directory, 'atlas-serve')
    await writeFile(path, content)
    binary = {
      version: 'dev-abc123',
      path,
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.byteLength,
    }
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('refuses a version that is not the binary it holds', async () => {
    const fake = fakeEngine()

    await expect(
      devServeInstaller(binary)({ engine: fake.engine, id: 'pod-id', name: 'pod', version: '1.2.3' }),
    ).rejects.toThrow(/dev-abc123.*1\.2\.3/)
    expect(fake.execs).toHaveLength(0)
    expect(fake.writes).toHaveLength(0)
  })

  it('stages the bytes under a dev-upload directory, then verifies and stamps in one bounded exec', async () => {
    const fake = fakeEngine()

    await devServeInstaller(binary)({
      engine: fake.engine,
      id: 'pod-id',
      name: 'pod',
      version: 'dev-abc123',
    })

    expect(fake.writes).toHaveLength(1)
    const write = fake.writes[0]!
    expect(write.id).toBe('pod-id')
    expect(write.path).toMatch(new RegExp(`^${SERVE_HOME}/dev-upload\\.[0-9a-f]{12}/atlas-serve$`))
    expect(write.mode).toBe(0o755)
    expect(Buffer.from(write.content as Uint8Array).toString()).toBe('#!dev-serve-bytes')

    const stageDir = write.path.replace('/atlas-serve', '')
    expect(fake.execs).toHaveLength(2)
    expect(fake.execs[0]!.script).toContain(`mkdir -p "${stageDir}"`)
    const install = fake.execs[1]!
    expect(install.script.startsWith('timeout -k 5 120 sh -c ')).toBe(true)
    expect(install.script).toContain(`got $_bytes want ${binary.bytes}`)
    expect(install.script).toContain(binary.sha256)
    expect(install.script).toContain('dev-abc123')
    expect(install.script).toContain(`rm -rf "${stageDir}"`)
  })

  it('removes the stage directory and rethrows when verification fails', async () => {
    const fake = fakeEngine({
      exitFor: (script) =>
        script.includes('sha256 mismatch') ? { exitCode: 1, stderr: 'atlas-serve sha256 mismatch' } : { exitCode: 0 },
    })

    await expect(
      devServeInstaller(binary)({ engine: fake.engine, id: 'pod-id', name: 'pod', version: 'dev-abc123' }),
    ).rejects.toThrow(/sha256 mismatch/)
    expect(fake.execs.at(-1)!.script).toContain('rm -rf')
  })
})
