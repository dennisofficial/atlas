import { describe, expect, it } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { hostOrigin, resolveHostOrigin } from '../host-url'

const SRC_DIR = join(import.meta.dir, '../../..')

async function clientSources(): Promise<{ path: string; text: string }[]> {
  const entries = await readdir(SRC_DIR, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .filter((entry) => !entry.parentPath.includes('__tests__'))
    .map((entry) => join(entry.parentPath, entry.name))
  return Promise.all(
    files.map(async (path) => ({
      path: path.slice(SRC_DIR.length + 1),
      text: await Bun.file(path).text(),
    })),
  )
}

describe('resolveHostOrigin', () => {
  it('follows the stream url to its http origin', () => {
    expect(resolveHostOrigin({ ATLAS_STREAM_URL: 'wss://stream.example.test/stream' })).toBe(
      'https://stream.example.test',
    )
    expect(resolveHostOrigin({ ATLAS_STREAM_URL: 'ws://localhost:10000/stream' })).toBe(
      'http://localhost:10000',
    )
  })

  it('defaults to the hosted agent host in production', () => {
    expect(resolveHostOrigin({ VERCEL_ENV: 'production' })).toBe('https://agent.byatlas.io')
  })
})

describe('hostOrigin', () => {
  it('reads the stream url the bundler inlines', () => {
    const before = process.env.ATLAS_STREAM_URL
    process.env.ATLAS_STREAM_URL = 'wss://stream.example.test/stream'
    try {
      expect(hostOrigin()).toBe('https://stream.example.test')
    } finally {
      if (before === undefined) delete process.env.ATLAS_STREAM_URL
      else process.env.ATLAS_STREAM_URL = before
    }
  })

  it('is never given a hand-built env object by a caller', async () => {
    const sources = await clientSources()
    const offenders = sources
      .filter((source) => /resolveHostOrigin\(\s*process\.env\s*\)/.test(source.text))
      .map((source) => source.path)
    expect(offenders).toEqual([])
  })
})
