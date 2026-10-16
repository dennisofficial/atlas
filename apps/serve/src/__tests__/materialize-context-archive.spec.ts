import { describe, expect, it } from 'bun:test'

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildContextArchive } from '@dltech/atlas-harness'
import { materializeContext } from '../materialize-context'
import type { FetchContextArchive } from '../workspace-spec'
import { ATLAS_HOME, fakeFiles, SPEC } from './materialize-context-fixture'

describe('materializeContext with an archive fetcher', () => {
  it('writes from the archive when the fetcher answers one', async () => {
    const { files, written } = fakeFiles()
    const staging = await mkdtemp(join(tmpdir(), 'atlas-materialize-archive-'))
    const source = join(staging, 'mcp.json')
    await writeFile(source, '# from the archive', 'utf8')
    const archive = await buildContextArchive({ files: [{ key: '.atlas/mcp.json', path: source }] })
    if (archive === undefined) throw new Error('expected an archive')
    const fetchArchive: FetchContextArchive = async () => archive

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe('# from the archive')
  })

  it('writes nothing once a persistent 404 exhausts the retry bound', async () => {
    const { files, written } = fakeFiles()
    let calls = 0
    const fetchArchive: FetchContextArchive = async () => {
      calls += 1
      return null
    }
    const slept: number[] = []

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      archiveRetry: { attempts: 3, intervalMs: 3_000, sleep: async (ms) => void slept.push(ms) },
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness).toEqual({ written: 0, failed: null, projectDirectory: null, identity: null })
    expect(written.size).toBe(0)
    expect(calls).toBe(3)
    expect(slept).toEqual([3_000, 3_000])
  })

  it('materializes from the archive once a 404 clears within the retry window, without waiting out the whole bound', async () => {
    const { files, written } = fakeFiles()
    const staging = await mkdtemp(join(tmpdir(), 'atlas-materialize-archive-retry-'))
    const source = join(staging, 'mcp.json')
    await writeFile(source, '# landed on the second try', 'utf8')
    const archive = await buildContextArchive({ files: [{ key: '.atlas/mcp.json', path: source }] })
    if (archive === undefined) throw new Error('expected an archive')
    let calls = 0
    const fetchArchive: FetchContextArchive = async () => {
      calls += 1
      return calls < 2 ? null : archive
    }
    const slept: number[] = []

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      archiveRetry: { attempts: 30, intervalMs: 3_000, sleep: async (ms) => void slept.push(ms) },
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness).toEqual({ written: 1, failed: null, projectDirectory: null, identity: null })
    expect(written.get(join(ATLAS_HOME, 'mcp.json'))).toBe('# landed on the second try')
    expect(calls).toBe(2)
    expect(slept).toEqual([3_000])
  })

  it('never retries a thrown transport error, unlike a 404', async () => {
    const { files } = fakeFiles()
    let calls = 0
    const fetchArchive: FetchContextArchive = async () => {
      calls += 1
      throw new Error('the control plane answered 502 for the context archive')
    }
    const slept: number[] = []

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      archiveRetry: { attempts: 30, intervalMs: 3_000, sleep: async (ms) => void slept.push(ms) },
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('502')
    expect(calls).toBe(1)
    expect(slept).toEqual([])
  })

  it('reports a genuine archive-fetch failure rather than silently falling back', async () => {
    const { files } = fakeFiles()
    const fetchArchive: FetchContextArchive = async () => {
      throw new Error('the control plane answered 502 for the context archive')
    }

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('502')
  })

  it('reports an archive that will not extract rather than silently writing nothing', async () => {
    const { files } = fakeFiles()
    const fetchArchive: FetchContextArchive = async () => new Uint8Array([1, 2, 3])

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC,
      fetchArchive,
      atlasHome: ATLAS_HOME,
      files,
    })

    expect(readiness.written).toBe(0)
    expect(readiness.failed).toContain('did not extract')
  })
})
