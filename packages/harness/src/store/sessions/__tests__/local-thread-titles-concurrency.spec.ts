import { afterEach, describe, expect, it } from 'bun:test'

import { openStoreFixture, type StoreFixture } from '../../__tests__/harness'
import { EThreadTitleSource, FileLocalThreadTitles } from '../../index'
import { readMetaSync, threadMetaSchema, writeMeta } from '../meta'
import { threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

async function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  const threadId = (await fixture.threads.create({})).id
  const sessionDir = await new SessionRegistry(fixture.home).sessionDirOf({ threadId })
  if (sessionDir === undefined) throw new Error('missing fixture thread')
  const file = threadMetaFile({ sessionDir, threadId })
  const oldMeta = readMetaSync({ file, schema: threadMetaSchema })
  if (oldMeta === undefined) throw new Error('missing fixture metadata')
  const titles = new FileLocalThreadTitles({ home: fixture.home })
  return { fixture, threadId, file, oldMeta, titles }
}

describe('local title metadata serialization', () => {
  it('gives simultaneous renames through two instances unique monotone revisions', async () => {
    const { fixture, threadId, titles } = await setup()
    const other = new FileLocalThreadTitles({ home: fixture.home })
    const renamed = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? titles : other).renameUser({ threadId, title: `Title ${index}` }),
      ),
    )
    expect(renamed.map(({ revision }) => revision).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
    const latest = renamed.find(({ revision }) => revision === 20)
    if (latest === undefined) throw new Error('missing final revision')
    expect(await titles.read({ threadId })).toEqual(latest)
  })

  it('serializes mixed stale metadata and title writes across processes', async () => {
    const { fixture, threadId, file, oldMeta, titles } = await setup()
    await titles.renameUser({ threadId, title: 'Start' })
    const titleModule = new URL('../local-thread-titles.ts', import.meta.url).pathname
    const metaModule = new URL('../meta.ts', import.meta.url).pathname
    const source = `
      import { FileLocalThreadTitles } from ${JSON.stringify(titleModule)}
      import { writeMeta } from ${JSON.stringify(metaModule)}
      const titles = new FileLocalThreadTitles({ home: ${JSON.stringify(fixture.home)} })
      const threadId = ${JSON.stringify(threadId)}
      console.log('ready')
      await Bun.stdin.text()
      const renamed = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
        await writeMeta({ file: ${JSON.stringify(file)}, meta: {
          ...${JSON.stringify(oldMeta)}, head: index + 10, modelRef: 'child-model',
        } })
        return titles.renameUser({ threadId, title: 'Child ' + index })
      }))
      console.log(JSON.stringify(renamed.map(({ revision }) => revision)))
    `
    const child = Bun.spawn([process.execPath, '--eval', source], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const reader = child.stdout.getReader()
    const ready = await reader.read()
    expect(new TextDecoder().decode(ready.value).trim()).toBe('ready')
    child.stdin.end()
    const remainingOutput = async () => {
      let output = ''
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return output
        output += new TextDecoder().decode(chunk.value)
      }
    }
    const parentRenames = Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        await writeMeta({ file, meta: { ...oldMeta, head: index + 100, modelRef: 'parent-model' } })
        return titles.renameUser({ threadId, title: `Parent ${index}` })
      }),
    )
    const [renamed, stdout, stderr, status] = await Promise.all([
      parentRenames,
      remainingOutput(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' })
    const childRevisions: unknown = JSON.parse(stdout)
    if (
      !Array.isArray(childRevisions) ||
      !childRevisions.every((value) => typeof value === 'number')
    ) {
      throw new Error(`invalid child revisions: ${stdout}`)
    }
    expect(
      [...renamed.map(({ revision }) => revision), ...childRevisions].sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 24 }, (_, index) => index + 2))
    expect(await titles.read({ threadId })).toMatchObject({
      source: EThreadTitleSource.User,
      revision: 25,
    })
    expect(readMetaSync({ file, schema: threadMetaSchema })?.head).toBeGreaterThan(0)
  })

  it('preserves authority against equal, older, and provenance-free snapshots', async () => {
    const { threadId, file, oldMeta, titles } = await setup()
    await titles.renameUser({ threadId, title: 'First' })
    const current = await titles.renameUser({ threadId, title: 'Second' })
    for (const fields of [
      { titleSource: EThreadTitleSource.Auto, titleRevision: 1 },
      { titleSource: EThreadTitleSource.User, titleRevision: 2 },
      { titleRevision: 99 },
    ]) {
      await writeMeta({ file, meta: { ...oldMeta, ...fields, title: 'Overwrite', head: 8 } })
      expect(await titles.read({ threadId })).toEqual(current)
      expect(readMetaSync({ file, schema: threadMetaSchema })?.head).toBe(8)
    }
  })

  it('preserves a user title through stale head and model snapshots and legacy rename', async () => {
    const { fixture, threadId, file, oldMeta, titles } = await setup()
    const renamed = await titles.renameUser({ threadId, title: 'User title' })
    await writeMeta({ file, meta: { ...oldMeta, head: 42, modelRef: 'new-model' } })
    expect(await titles.read({ threadId })).toEqual(renamed)
    expect(readMetaSync({ file, schema: threadMetaSchema })).toMatchObject({
      title: 'User title',
      titleSource: EThreadTitleSource.User,
      titleRevision: 1,
      head: 42,
      modelRef: 'new-model',
    })
    await fixture.threads.rename({ threadId, title: 'Legacy overwrite' })
    expect(await titles.read({ threadId })).toEqual(renamed)
  })
})
