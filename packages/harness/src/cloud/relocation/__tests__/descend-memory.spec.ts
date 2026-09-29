import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EClientRequest } from '../../channel-wire'

import { buildContextArchive, type ArchiveFileSource } from '../../context-archive'
import { cloudArchiveOf, descend, useDescendHome } from './descend-fixture'
import { CLOUD_THREAD, fakeBridge } from './fixture'

const OLD = new Date('2026-09-20T10:00:00.000Z')
const NEW = new Date('2026-09-28T10:00:00.000Z')

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0, scratch.length)) rmSync(dir, { recursive: true, force: true })
})

const stagedRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'atlas-descend-memory-repo-'))
  scratch.push(repo)
  return repo
}

const memoryTarOf = async (
  files: readonly { key: string; content: string; at: Date }[],
): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-descend-memory-tar-'))
  scratch.push(dir)
  const sources: ArchiveFileSource[] = []
  for (const file of files) {
    const path = join(dir, file.key.replaceAll('/', '-'))
    writeFileSync(path, file.content)
    utimesSync(path, file.at, file.at)
    sources.push({ key: file.key, path })
  }
  const archive = await buildContextArchive({ files: sources })
  if (archive === undefined) throw new Error('the staged archive should not be empty')
  return archive.toString('base64')
}

const transcriptArchive = (): Promise<string | undefined> =>
  cloudArchiveOf([{ drafts: [{ type: 'user-said', text: 'one' }] }])

describe('the descend’s memory transfer', () => {
  it('requests the memory archive and merges it before the sandbox is destroyed', async () => {
    const home = useDescendHome()
    const repo = stagedRepo()
    home.workspace = { workspace: repo, repo }
    const memoryArchive = await memoryTarOf([
      { key: '.atlas/memory/fact.md', content: 'what the cloud session learned', at: NEW },
    ])
    const bridge = fakeBridge({ archive: await transcriptArchive(), memoryArchive })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const order: string[] = []
    const served = channel.request.bind(channel)
    channel.request = async (given) => {
      if (given.op === EClientRequest.ReadMemoryArchive) order.push('memory')
      return served(given)
    }
    const destroy = bridge.sandboxes.destroy.bind(bridge.sandboxes)
    bridge.sandboxes.destroy = async (given) => {
      order.push('destroy')
      return destroy(given)
    }

    await descend({ bridge, home, channel })

    const requests = channel.requests.map((request) => request.op)
    expect(requests).toContain(EClientRequest.ReadMemoryArchive)
    expect(order.indexOf('memory')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('destroy')).toBeGreaterThan(order.indexOf('memory'))
    expect(readFileSync(join(useAtlasHomeOf(), 'memory', 'fact.md'), 'utf8')).toBe(
      'what the cloud session learned',
    )
  })

  it('keeps a host-newer memory file and one the archive never carried', async () => {
    const home = useDescendHome()
    const repo = stagedRepo()
    home.workspace = { workspace: repo, repo }
    const atlasHome = useAtlasHomeOf()
    mkdirSync(join(atlasHome, 'memory'), { recursive: true })
    writeFileSync(join(atlasHome, 'memory', 'fresh.md'), 'another machine’s newer memory')
    utimesSync(join(atlasHome, 'memory', 'fresh.md'), NEW, NEW)
    writeFileSync(join(atlasHome, 'memory', 'only-here.md'), 'never lifted')
    utimesSync(join(atlasHome, 'memory', 'only-here.md'), OLD, OLD)
    const memoryArchive = await memoryTarOf([
      { key: '.atlas/memory/fresh.md', content: 'the sandbox’s older copy', at: OLD },
    ])
    const bridge = fakeBridge({ archive: await transcriptArchive(), memoryArchive })

    await descend({ bridge, home })

    expect(readFileSync(join(atlasHome, 'memory', 'fresh.md'), 'utf8')).toBe(
      'another machine’s newer memory',
    )
    expect(readFileSync(join(atlasHome, 'memory', 'only-here.md'), 'utf8')).toBe('never lifted')
  })

  it('no-ops when the sandbox holds no memory, without failing the descend', async () => {
    const home = useDescendHome()
    const repo = stagedRepo()
    home.workspace = { workspace: repo, repo }
    const bridge = fakeBridge({ archive: await transcriptArchive() })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel

    const opened = await descend({ bridge, home, channel })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
  })

  it('no-ops when the serve is too old to know the op', async () => {
    const home = useDescendHome()
    const repo = stagedRepo()
    home.workspace = { workspace: repo, repo }
    const bridge = fakeBridge({ archive: await transcriptArchive() })
    const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
    const served = channel.request.bind(channel)
    channel.request = async (given) => {
      if (given.op === EClientRequest.ReadMemoryArchive) {
        throw new Error('unknown request op: read-memory-archive')
      }
      return served(given)
    }

    const opened = await descend({ bridge, home, channel })

    expect(opened.threadId).toBe(CLOUD_THREAD)
    expect(bridge.destroyed).toEqual([CLOUD_THREAD])
  })
})

const useAtlasHomeOf = (): string => {
  const home = process.env['ATLAS_HOME']
  if (home === undefined) throw new Error('the fixture did not stage an ATLAS_HOME')
  return home
}
