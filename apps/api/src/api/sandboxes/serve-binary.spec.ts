import { createHash } from 'node:crypto'
import { ServiceUnavailableException, StreamableFile } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvService } from '../../_core/config/env/env.service'
import { DEFAULT_SERVE_BINARY_PATH, ServeBinaryService } from './serve-binary'

const files = vi.hoisted(() => ({
  contents: new Map<string, string | Uint8Array>(),
  readFileCalls: 0,
}))

vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => {
    files.readFileCalls += 1
    const content = files.contents.get(path)
    if (content === undefined) throw new Error('ENOENT')
    return content
  },
  stat: async (path: string) => {
    if (!files.contents.has(path)) throw new Error('ENOENT')
    return {}
  },
}))

vi.mock('node:fs', () => ({
  createReadStream: (path: string) => ({ path }),
}))

const envWith = (values: Record<string, string | undefined>): EnvService =>
  ({ get: (key: string) => values[key] }) as unknown as EnvService

const binary = new Uint8Array([0x7f, 0x45, 0x4c, 0x46])
const binaryStamp = createHash('sha256').update(binary).digest('hex')

describe('ServeBinaryService', () => {
  beforeEach(() => {
    files.contents.clear()
    files.readFileCalls = 0
  })

  it('memoizes the stamp so a second launch never re-reads the binary', async () => {
    files.contents.set(`${DEFAULT_SERVE_BINARY_PATH}.sha256`, 'build-stamp\n')
    const service = new ServeBinaryService(envWith({}))

    await expect(service.stamp()).resolves.toBe('build-stamp')
    await expect(service.stamp()).resolves.toBe('build-stamp')

    expect(files.readFileCalls).toBe(1)
  })

  it('reads the stamp the image build wrote next to the binary', async () => {
    files.contents.set(`${DEFAULT_SERVE_BINARY_PATH}.sha256`, 'build-stamp\n')
    const service = new ServeBinaryService(envWith({}))

    await expect(service.stamp()).resolves.toBe('build-stamp')
  })

  it('hashes the binary when no stamp file exists, as in a dev override', async () => {
    files.contents.set('/opt/atlas/atlas-serve', binary)
    const service = new ServeBinaryService(envWith({ SANDBOX_SERVE_BINARY: '/opt/atlas/atlas-serve' }))

    await expect(service.stamp()).resolves.toBe(binaryStamp)
  })

  it('503s when the deployment carries no binary at all', async () => {
    const service = new ServeBinaryService(envWith({}))

    await expect(service.stamp()).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(service.stamp()).rejects.toThrow(DEFAULT_SERVE_BINARY_PATH)
  })

  it('streams the binary as an octet-stream download', async () => {
    files.contents.set(DEFAULT_SERVE_BINARY_PATH, binary)
    const service = new ServeBinaryService(envWith({}))

    const streamed = await service.stream()

    expect(streamed).toBeInstanceOf(StreamableFile)
  })

  it('503s the download when the binary is missing', async () => {
    const service = new ServeBinaryService(envWith({}))

    await expect(service.stream()).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('hashes the binary itself for integrity, regardless of a build-stamp sidecar', async () => {
    files.contents.set(`${DEFAULT_SERVE_BINARY_PATH}.sha256`, 'build-stamp\n')
    files.contents.set(DEFAULT_SERVE_BINARY_PATH, binary)
    const service = new ServeBinaryService(envWith({}))

    await expect(service.binaryHash()).resolves.toBe(binaryStamp)
    await expect(service.stamp()).resolves.toBe('build-stamp')
  })

  it('memoizes the binary hash so a second call never re-reads the binary', async () => {
    files.contents.set(DEFAULT_SERVE_BINARY_PATH, binary)
    const service = new ServeBinaryService(envWith({}))

    await expect(service.binaryHash()).resolves.toBe(binaryStamp)
    await expect(service.binaryHash()).resolves.toBe(binaryStamp)

    expect(files.readFileCalls).toBe(1)
  })

  it('shares its one binary read with the dev-override stamp fallback', async () => {
    files.contents.set('/opt/atlas/atlas-serve', binary)
    const service = new ServeBinaryService(envWith({ SANDBOX_SERVE_BINARY: '/opt/atlas/atlas-serve' }))

    await expect(service.stamp()).resolves.toBe(binaryStamp)
    const readsAfterStamp = files.readFileCalls

    await expect(service.binaryHash()).resolves.toBe(binaryStamp)

    expect(files.readFileCalls).toBe(readsAfterStamp)
  })

  it('503s hashing the binary when it is missing', async () => {
    const service = new ServeBinaryService(envWith({}))

    await expect(service.binaryHash()).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
