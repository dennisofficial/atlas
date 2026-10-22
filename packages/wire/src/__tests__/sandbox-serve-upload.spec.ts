import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { Sandbox } from '@vercel/sandbox'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire.js'
import {
  DEV_SERVE_UPLOAD_ATTEMPTS,
  DEV_SERVE_UPLOAD_CHUNK_BYTES,
  devServeAssembleScript,
  isDevServeVersion,
  uploadDevServe,
  uploadServeInstaller,
} from '../sandbox-serve-upload.js'
import type { DevServeBinary } from '../sandbox-sdk.js'
import { SERVE_HOME, SERVE_PROTOCOL_PATH, SERVE_VERSION_PATH } from '../serve-env.js'

interface RecordedWrite {
  path: string
  content: Uint8Array
}

interface RecordedCommand {
  cmd: string
  args?: string[]
  timeoutMs?: number
}

const fakeSandbox = (args: {
  failWritesBeforeSuccess?: number
  assembleExitCode?: number
  assembleStderr?: string
}) => {
  const writes: RecordedWrite[] = []
  const scripts: string[] = []
  let writeFailuresLeft = args.failWritesBeforeSuccess ?? 0
  const sandbox = {
    writeFiles: async (files: RecordedWrite[]) => {
      if (writeFailuresLeft > 0) {
        writeFailuresLeft -= 1
        throw new Error('socket hang up')
      }
      writes.push(...files)
    },
    runCommand: async (params: RecordedCommand) => {
      const script = params.args?.[1] ?? ''
      scripts.push(script)
      if (script.startsWith('set -eu')) {
        return {
          exitCode: args.assembleExitCode ?? 0,
          stderr: async () => args.assembleStderr ?? '',
        }
      }
      return { exitCode: 0, stderr: async () => '' }
    },
  }
  return { sandbox: sandbox as unknown as Sandbox, writes, scripts }
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

let workDir = ''

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'serve-upload-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

const binaryOnDisk = async (args: { bytes: number; version?: string }): Promise<DevServeBinary> => {
  const content = new Uint8Array(args.bytes).map((_unused, index) => (index * 31 + 7) % 251)
  const path = join(workDir, 'atlas-serve-linux-x64')
  await writeFile(path, content)
  return {
    version: args.version ?? 'dev-0123456789ab',
    path,
    sha256: sha256Of(content),
    bytes: args.bytes,
  }
}

describe('isDevServeVersion', () => {
  it('recognizes only dev- pins', () => {
    expect(isDevServeVersion('dev-abc')).toBe(true)
    expect(isDevServeVersion('1.2.3')).toBe(false)
    expect(isDevServeVersion(undefined)).toBe(false)
  })
})

describe('uploadDevServe', () => {
  it('defaults to 4 MiB parts', () => {
    expect(DEV_SERVE_UPLOAD_CHUNK_BYTES).toBe(4 * 1024 * 1024)
  })

  it('splits the binary into zero-padded parts under a per-install staging dir', async () => {
    const binary = await binaryOnDisk({ bytes: 25 })
    const { sandbox, writes, scripts } = fakeSandbox({})
    const lines: string[] = []

    await uploadDevServe({ sandbox, binary, chunkBytes: 10, log: (line) => lines.push(line) })

    expect(writes.map((write) => write.content.length)).toEqual([10, 10, 5])
    const stageDir = dirname(writes[0]?.path ?? '')
    expect(stageDir).toMatch(new RegExp(`^${SERVE_HOME}/\\.upload-[0-9a-f]{12}$`))
    expect(writes.map((write) => write.path)).toEqual([
      `${stageDir}/part-00000`,
      `${stageDir}/part-00001`,
      `${stageDir}/part-00002`,
    ])
    const reassembled = Buffer.concat(writes.map((write) => write.content))
    expect(sha256Of(reassembled)).toBe(binary.sha256)
    expect(scripts[0]).toBe(`mkdir -p "${stageDir}"`)
    expect(lines.filter((line) => line.includes('chunks'))).toHaveLength(3)
    expect(lines).toContain(`uploading dev serve ${binary.version}: 2/3 chunks (0/0 MB)`)
  })

  it('verifies size and sha256 before staging, then stamps the dev version and protocol', () => {
    const binary: DevServeBinary = { version: 'dev-feed', path: '/x', sha256: 'abc', bytes: 9 }
    const script = devServeAssembleScript({ binary, stageDir: '/opt/atlas/.upload-1', parts: 2 })

    expect(script).toContain(
      'cat "/opt/atlas/.upload-1/part-00000" "/opt/atlas/.upload-1/part-00001"',
    )
    expect(script.indexOf('size mismatch')).toBeLessThan(script.indexOf('sha256 mismatch'))
    expect(script.indexOf('sha256 mismatch')).toBeLessThan(script.indexOf('install -m 0755'))
    expect(script).toContain(`printf '%s' 'dev-feed' > "${SERVE_VERSION_PATH}"`)
    expect(script).toContain(`printf '%s' '${CHANNEL_PROTOCOL_VERSION}' > "${SERVE_PROTOCOL_PATH}"`)
    expect(script).toContain(`trap 'rm -rf "/opt/atlas/.upload-1"; rm -f "$_stage"' EXIT`)
  })

  it('surfaces a failing reassembly with its stderr', async () => {
    const binary = await binaryOnDisk({ bytes: 4 })
    const { sandbox } = fakeSandbox({
      assembleExitCode: 1,
      assembleStderr: 'atlas-serve sha256 mismatch: got aa want bb',
    })

    await expect(uploadDevServe({ sandbox, binary, chunkBytes: 2 })).rejects.toThrow(
      'failed (exit 1): atlas-serve sha256 mismatch: got aa want bb',
    )
  })

  it('retries a transient part failure', async () => {
    const binary = await binaryOnDisk({ bytes: 4 })
    const { sandbox, writes } = fakeSandbox({ failWritesBeforeSuccess: 2 })

    await uploadDevServe({ sandbox, binary, chunkBytes: 2, retryDelayMs: 0 })

    expect(writes).toHaveLength(2)
  })

  it('gives up after a bounded number of attempts and clears the staging dir', async () => {
    const binary = await binaryOnDisk({ bytes: 4 })
    const { sandbox, writes, scripts } = fakeSandbox({
      failWritesBeforeSuccess: DEV_SERVE_UPLOAD_ATTEMPTS,
    })

    await expect(
      uploadDevServe({ sandbox, binary, chunkBytes: 2, retryDelayMs: 0 }),
    ).rejects.toThrow(`failed after ${DEV_SERVE_UPLOAD_ATTEMPTS} attempts: socket hang up`)

    expect(writes).toHaveLength(0)
    expect(scripts.at(-1)).toMatch(/^rm -rf "\/opt\/atlas\/\.upload-[0-9a-f]+"$/)
    expect(scripts.some((script) => script.startsWith('set -eu'))).toBe(false)
  })

  it('refuses a binary whose size on disk disagrees with its record', async () => {
    const binary = await binaryOnDisk({ bytes: 4 })
    const { sandbox, writes } = fakeSandbox({})

    await expect(
      uploadDevServe({ sandbox, binary: { ...binary, bytes: 5 }, chunkBytes: 2 }),
    ).rejects.toThrow('is 4 bytes, expected 5')
    expect(writes).toHaveLength(0)
  })
})

describe('uploadServeInstaller', () => {
  it('refuses to install any version but the one it holds, without uploading', async () => {
    const binary = await binaryOnDisk({ bytes: 4, version: 'dev-aaaa' })
    const { sandbox, writes, scripts } = fakeSandbox({})
    const install = uploadServeInstaller(binary)

    await expect(install({ sandbox, version: 'dev-bbbb' })).rejects.toThrow(
      'cannot install dev-bbbb',
    )
    await expect(install({ sandbox, version: undefined })).rejects.toThrow('cannot install latest')
    expect(writes).toHaveLength(0)
    expect(scripts).toHaveLength(0)
  })
})

const localSandbox = (root: string) => {
  const local = (path: string): string => path.replaceAll(SERVE_HOME, root)
  const sandbox = {
    writeFiles: async (files: RecordedWrite[]) => {
      for (const file of files) {
        await mkdir(dirname(local(file.path)), { recursive: true })
        await writeFile(local(file.path), file.content)
      }
    },
    runCommand: async (params: RecordedCommand) => {
      const run = spawnSync('sh', ['-c', local(params.args?.[1] ?? '')], { encoding: 'utf8' })
      return { exitCode: run.status ?? 1, stderr: async () => run.stderr }
    },
  }
  return sandbox as unknown as Sandbox
}

const hasSha256sum = spawnSync('sh', ['-c', 'command -v sha256sum']).status === 0

describe.skipIf(!hasSha256sum)('the reassembly script under a real sh', () => {
  it('installs the binary and both stamps, leaving no staging behind', async () => {
    const binary = await binaryOnDisk({ bytes: 1000, version: 'dev-cafe' })
    const root = join(workDir, 'opt-atlas')
    await mkdir(root)

    await uploadDevServe({ sandbox: localSandbox(root), binary, chunkBytes: 64 })

    const installed = await readFile(join(root, 'atlas-serve'))
    expect(sha256Of(installed)).toBe(binary.sha256)
    expect((await stat(join(root, 'atlas-serve'))).mode & 0o777).toBe(0o755)
    expect(await readFile(join(root, 'atlas-serve.version'), 'utf8')).toBe('dev-cafe')
    expect(await readFile(join(root, 'atlas-serve.protocol'), 'utf8')).toBe(
      String(CHANNEL_PROTOCOL_VERSION),
    )
    const leftovers = spawnSync('ls', ['-A', root], { encoding: 'utf8' }).stdout.trim().split('\n')
    expect(leftovers.sort()).toEqual(['atlas-serve', 'atlas-serve.protocol', 'atlas-serve.version'])
  })

  it('rejects a sha mismatch before touching the live binary', async () => {
    const binary = await binaryOnDisk({ bytes: 100 })
    const root = join(workDir, 'opt-atlas')
    await mkdir(root)
    await writeFile(join(root, 'atlas-serve'), 'previous')

    await expect(
      uploadDevServe({
        sandbox: localSandbox(root),
        binary: { ...binary, sha256: '0'.repeat(64) },
        chunkBytes: 16,
      }),
    ).rejects.toThrow(`atlas-serve sha256 mismatch: got ${binary.sha256} want ${'0'.repeat(64)}`)

    expect(await readFile(join(root, 'atlas-serve'), 'utf8')).toBe('previous')
    const leftovers = spawnSync('ls', ['-A', root], { encoding: 'utf8' }).stdout.trim()
    expect(leftovers).toBe('atlas-serve')
  })
})
