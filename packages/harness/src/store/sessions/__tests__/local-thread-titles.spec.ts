import { afterEach, describe, expect, it } from 'bun:test'
import { readFile, readdir } from 'node:fs/promises'

import { toThreadId } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from '../../__tests__/harness'
import { EThreadTitleSource, FileLocalThreadTitles } from '../../index'
import { readMetaSync, threadMetaSchema } from '../meta'
import { threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  return fixture
}

describe('FileLocalThreadTitles', () => {
  it('rejects missing threads without creating any session directories', async () => {
    const fixture = setup()
    const titles = new FileLocalThreadTitles({ home: fixture.home })
    const threadId = toThreadId('missing-thread')
    await expect(titles.read({ threadId })).rejects.toThrow('does not exist')
    await expect(titles.renameUser({ threadId, title: 'Missing' })).rejects.toThrow(
      'does not exist',
    )
    await expect(
      titles.proposeAuto({ threadId, title: 'Missing', expectedRevision: 0 }),
    ).rejects.toThrow('does not exist')
    expect(await readdir(fixture.home)).toEqual([])
  })

  it('resolves a child title within its containing session rather than creating a root', async () => {
    const fixture = setup()
    const parent = await fixture.threads.create({})
    const threadId = (await fixture.threads.create({ sessionId: parent.id })).id
    const titles = new FileLocalThreadTitles({ home: fixture.home })
    const renamed = await titles.renameUser({ threadId, title: 'Child title' })
    expect(await titles.read({ threadId })).toEqual(renamed)
    expect((await fixture.threads.find({ threadId }))?.title).toBe('Child title')
    expect(await readdir(`${fixture.home}/sessions`)).toEqual([parent.id])
  })

  it('accepts only an initial matching auto proposal and leaves rejected proposals untouched', async () => {
    const fixture = setup()
    const threadId = (await fixture.threads.create({})).id
    const titles = new FileLocalThreadTitles({ home: fixture.home })
    expect(await titles.proposeAuto({ threadId, title: 'Too early', expectedRevision: 1 })).toEqual(
      { title: null, source: null, revision: 0 },
    )
    const sessionDir = await new SessionRegistry(fixture.home).sessionDirOf({ threadId })
    if (sessionDir === undefined) throw new Error('missing fixture thread')
    const file = threadMetaFile({ sessionDir, threadId })
    const accepted = { title: 'Generated', source: EThreadTitleSource.Auto, revision: 1 }
    expect(await titles.proposeAuto({ threadId, title: 'Generated', expectedRevision: 0 })).toEqual(
      accepted,
    )
    const contents = await readFile(file, 'utf8')
    expect(await titles.proposeAuto({ threadId, title: 'Replay', expectedRevision: 0 })).toEqual(
      accepted,
    )
    expect(
      await titles.proposeAuto({ threadId, title: 'Replacement', expectedRevision: 1 }),
    ).toEqual(accepted)
    expect(await new FileLocalThreadTitles({ home: fixture.home }).read({ threadId })).toEqual(
      accepted,
    )
    expect(await readFile(file, 'utf8')).toBe(contents)
  })

  it('protects named legacy metadata without inventing user provenance', async () => {
    const fixture = setup()
    const threadId = (await fixture.threads.create({ title: 'Legacy' })).id
    const titles = new FileLocalThreadTitles({ home: fixture.home })
    const legacy = { title: 'Legacy', source: null, revision: 0 }
    expect(await titles.read({ threadId })).toEqual(legacy)
    expect(await titles.proposeAuto({ threadId, title: 'Remote', expectedRevision: 0 })).toEqual(
      legacy,
    )
    expect(await titles.renameUser({ threadId, title: 'Explicit' })).toEqual({
      title: 'Explicit',
      source: EThreadTitleSource.User,
      revision: 1,
    })
  })

  it('keeps a user rename when a delayed auto proposal arrives', async () => {
    const fixture = setup()
    const threadId = (await fixture.threads.create({})).id
    const titles = new FileLocalThreadTitles({ home: fixture.home })
    const { revision } = await titles.read({ threadId })
    const renamed = await titles.renameUser({ threadId, title: 'User wins' })
    expect(
      await titles.proposeAuto({ threadId, title: 'Delayed', expectedRevision: revision }),
    ).toEqual(renamed)
    expect(
      await titles.proposeAuto({ threadId, title: 'Fresh', expectedRevision: renamed.revision }),
    ).toEqual(renamed)
  })

  it('persists user provenance and increments the revision even for the same title', async () => {
    const fixture = setup()
    const threadId = (await fixture.threads.create({})).id
    const titles = new FileLocalThreadTitles({ home: fixture.home })
    expect(await titles.read({ threadId })).toEqual({ title: null, source: null, revision: 0 })

    expect(await titles.renameUser({ threadId, title: 'My title' })).toEqual({
      title: 'My title',
      source: EThreadTitleSource.User,
      revision: 1,
    })
    const reopened = new FileLocalThreadTitles({ home: fixture.home })
    expect(await reopened.read({ threadId })).toEqual({
      title: 'My title',
      source: EThreadTitleSource.User,
      revision: 1,
    })
    expect(await reopened.renameUser({ threadId, title: 'My title' })).toEqual({
      title: 'My title',
      source: EThreadTitleSource.User,
      revision: 2,
    })
    const sessionDir = await new SessionRegistry(fixture.home).sessionDirOf({ threadId })
    if (sessionDir === undefined) throw new Error('missing fixture thread')
    expect(
      readMetaSync({ file: threadMetaFile({ sessionDir, threadId }), schema: threadMetaSchema }),
    ).toMatchObject({ title: 'My title', titleSource: EThreadTitleSource.User, titleRevision: 2 })
  })
})
