import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  droppedNames,
  objectKeyOf,
  objectListKeyOf,
  parseMirrorArgs,
  publicUrlOf,
  servedHash,
  verify,
} from '../mirror-release'

describe('parseMirrorArgs', () => {
  it('takes the tag and both flags', () => {
    expect(parseMirrorArgs(['tui-v1.2.3', '--latest', '--prune'])).toEqual({
      tag: 'tui-v1.2.3',
      latest: true,
      prune: true,
    })
  })

  it('defaults both flags off', () => {
    expect(parseMirrorArgs(['web-ota'])).toEqual({ tag: 'web-ota', latest: false, prune: false })
  })

  it('refuses a missing tag and an unknown flag', () => {
    expect(() => parseMirrorArgs([])).toThrow('usage')
    expect(() => parseMirrorArgs(['tui-v1.2.3', '--force'])).toThrow('unknown flags: --force')
  })
})

describe('object keys', () => {
  it('keys a tagged asset the way the worker looks it up', () => {
    expect(objectKeyOf({ tag: 'tui-v1.2.3', name: 'atlas-linux-x64' })).toBe(
      'releases/tui-v1.2.3/atlas-linux-x64',
    )
    expect(objectListKeyOf('web-ota')).toBe('releases/web-ota/objects.json')
  })
})

describe('public URLs', () => {
  it('asks for the latest asset through the moving pointer', () => {
    expect(publicUrlOf({ tag: 'tui-v1.2.3', name: 'latest-mac.yml', latest: true })).toBe(
      'https://install.byatlas.io/releases/latest/download/latest-mac.yml',
    )
  })

  it('asks for a tagged asset by its tag', () => {
    expect(publicUrlOf({ tag: 'tui-v1.2.3', name: 'atlas-linux-x64', latest: false })).toBe(
      'https://install.byatlas.io/releases/download/tui-v1.2.3/atlas-linux-x64',
    )
  })
})

describe('droppedNames', () => {
  it('names the objects the new upload no longer covers', () => {
    expect(
      droppedNames({
        previous: ['web-update.json', 'web-old.tar.gz', 'web-kept.tar.gz'],
        uploaded: ['web-update.json', 'web-kept.tar.gz', 'web-new.tar.gz'],
      }),
    ).toEqual(['web-old.tar.gz'])
  })
})

const encoder = new TextEncoder()

const droppedBody = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text.slice(0, 2)))
      controller.error(new TypeError('The socket connection was closed unexpectedly'))
    },
  })

const digestOfBytes = (bytes: Uint8Array): string => {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(bytes)
  return hasher.digest('hex')
}

describe('servedHash', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('hashes a body that arrives in one piece', async () => {
    const payload = encoder.encode('release bytes')
    globalThis.fetch = (async () => new Response(payload)) as unknown as typeof fetch
    expect(
      await servedHash({ url: 'https://install.byatlas.io/releases/latest/download/x' }),
    ).toEqual({ bytes: payload.byteLength, digest: digestOfBytes(payload) })
  })

  it('repeats the download when the socket drops mid-body', async () => {
    const payload = encoder.encode('release bytes')
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return calls === 1 ? new Response(droppedBody('release bytes')) : new Response(payload)
    }) as unknown as typeof fetch
    const served = await servedHash({ url: 'https://install.byatlas.io/x', backoffMs: 0 })
    expect(served).toEqual({ bytes: payload.byteLength, digest: digestOfBytes(payload) })
    expect(calls).toBe(2)
  })

  it('gives up after the last attempt', async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response(droppedBody('release bytes'))
    }) as unknown as typeof fetch
    await expect(
      servedHash({ url: 'https://install.byatlas.io/x', attempts: 3, backoffMs: 0 }),
    ).rejects.toThrow('socket connection was closed')
    expect(calls).toBe(3)
  })

  it('refuses an answer that is not a served asset', async () => {
    globalThis.fetch = (async () =>
      new Response('missing', { status: 404 })) as unknown as typeof fetch
    await expect(servedHash({ url: 'https://install.byatlas.io/x', attempts: 1 })).rejects.toThrow(
      'answered 404',
    )
  })
})

describe('verify', () => {
  const realFetch = globalThis.fetch
  const dirs: string[] = []

  afterEach(() => {
    globalThis.fetch = realFetch
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('verifies the asset the mirror served after dropping the first body', async () => {
    const payload = encoder.encode('path: Atlas-1.2.3-arm64.zip\n')
    const dir = mkdtempSync(join(tmpdir(), 'mirror-verify-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'latest-mac.yml'), payload)
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return calls === 1 ? new Response(droppedBody('path: Atlas')) : new Response(payload)
    }) as unknown as typeof fetch
    await verify({
      dir,
      names: ['latest-mac.yml'],
      mirror: { tag: 'tui-v1.2.3', latest: true, prune: false },
    })
    expect(calls).toBe(2)
  })

  it('fails when the mirror serves bytes that do not match the download', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mirror-verify-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'latest-mac.yml'), encoder.encode('path: Atlas-1.2.3-arm64.zip\n'))
    globalThis.fetch = (async () =>
      new Response(encoder.encode('path: Atlas-9.9.9-arm64.zip\n'))) as unknown as typeof fetch
    await expect(
      verify({
        dir,
        names: ['latest-mac.yml'],
        mirror: { tag: 'tui-v1.2.3', latest: false, prune: false },
      }),
    ).rejects.toThrow('served the wrong bytes')
  })
})
