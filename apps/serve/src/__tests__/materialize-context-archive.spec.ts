import { describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { normalizeRepoOrigin } from '@dltech/atlas-core'
import { buildContextArchive, sandboxUserLayerTrees } from '@dltech/atlas-harness'
import { writeContextEntries } from '../context-entries'
import { materializeContext } from '../materialize-context'
import type { FetchContextArchive } from '../workspace-spec'
import { ATLAS_HOME, CONTEXT_STAMP_PATH, fakeFiles, SPEC } from './materialize-context-fixture'

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

const REMOTE_URL = 'git@github.com:comp-ai/atlas.git'
const PROJECT_DIRECTORY = '/srv/workspace/atlas'
const SPEC_WITH_REMOTE = { ...SPEC, remoteUrl: REMOTE_URL }

const archiveOf = async (entries: Record<string, string>): Promise<Uint8Array> => {
  const staging = await mkdtemp(join(tmpdir(), 'atlas-materialize-user-layer-'))
  const files = []
  for (const [key, text] of Object.entries(entries)) {
    const path = join(staging, 'sources', key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, 'utf8')
    files.push({ key, path })
  }
  const archive = await buildContextArchive({ files })
  if (archive === undefined) throw new Error('expected an archive')
  return archive
}

describe('materializeContext with a user-layer archive', () => {
  it('restores skills and instructions into the sandbox layout and stamps the receipt', async () => {
    const { files, written, stamped } = fakeFiles()
    const archive = await archiveOf({
      'user-layer/skills/.atlas/demo/SKILL.md': '# demo skill',
      'user-layer/instructions/.atlas/ATLAS.md': '# global instructions',
    })

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC_WITH_REMOTE,
      fetchArchive: async () => archive,
      atlasHome: ATLAS_HOME,
      projectDirectory: PROJECT_DIRECTORY,
      files,
    })

    expect(readiness.failed).toBeNull()
    expect(readiness.written).toBe(2)
    expect(written.get(join(ATLAS_HOME, 'skills', 'demo', 'SKILL.md'))).toBe('# demo skill')
    expect(written.get(join(ATLAS_HOME, 'ATLAS.md'))).toBe('# global instructions')
    expect(stamped.has(CONTEXT_STAMP_PATH)).toBe(true)
  })

  it('lands a project-local instructions file in the project directory it was given', async () => {
    const { files, written } = fakeFiles()
    const archive = await archiveOf({ 'user-layer/instructions/project/CLAUDE.local.md': '# local rules' })

    await materializeContext({
      fetchSpec: async () => SPEC_WITH_REMOTE,
      fetchArchive: async () => archive,
      atlasHome: ATLAS_HOME,
      projectDirectory: PROJECT_DIRECTORY,
      files,
    })

    expect(written.get(join(PROJECT_DIRECTORY, 'CLAUDE.local.md'))).toBe('# local rules')
  })

  it('writes nothing on a second boot once the stamp is present', async () => {
    const { files, written } = fakeFiles()
    const archive = await archiveOf({ 'user-layer/skills/.atlas/demo/SKILL.md': '# demo skill' })
    const boot = (fetchArchive: () => Promise<Uint8Array>) =>
      materializeContext({
        fetchSpec: async () => SPEC_WITH_REMOTE,
        fetchArchive,
        atlasHome: ATLAS_HOME,
        projectDirectory: PROJECT_DIRECTORY,
        files,
      })
    await boot(async () => archive)
    written.clear()
    let archiveCalls = 0

    const second = await boot(async () => {
      archiveCalls += 1
      return archive
    })

    expect(second.written).toBe(0)
    expect(archiveCalls).toBe(0)
    expect(written.size).toBe(0)
  })

  it('ignores archive keys that name no tree, including legacy memory keys', async () => {
    const { files, written } = fakeFiles()
    const archive = await archiveOf({
      'user-layer/memory/user/a/b.md': 'nested',
      'user-layer/bogus/x': 'bogus',
    })

    const readiness = await materializeContext({
      fetchSpec: async () => SPEC_WITH_REMOTE,
      fetchArchive: async () => archive,
      atlasHome: ATLAS_HOME,
      projectDirectory: PROJECT_DIRECTORY,
      files,
    })

    expect(readiness).toEqual({
      written: 0,
      failed: null,
      projectDirectory: null,
      identity: normalizeRepoOrigin(REMOTE_URL),
    })
    expect(written.size).toBe(0)
  })

  it('refuses traversal keys before any write', async () => {
    const { files, written } = fakeFiles()
    const trees = sandboxUserLayerTrees({
      atlasHome: ATLAS_HOME,
      projectDirectory: PROJECT_DIRECTORY,
    })
    const entry = (path: string) => ({ path, readBytes: async () => Buffer.from('x') })

    const outcome = await writeContextEntries({
      files,
      entries: [
        entry('user-layer/skills/../../etc/x'),
        entry('user-layer/skills/.atlas/../../etc/x'),
        entry('user-layer/memory/user/a/b.md'),
        entry('user-layer/bogus/x'),
      ],
      targets: { atlasHome: ATLAS_HOME, userLayerTrees: trees },
      overwrite: true,
    })

    expect(outcome).toEqual({ written: 0, failed: null })
    expect(written.size).toBe(0)
  })
})
