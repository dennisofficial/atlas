import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  EMPTY_PUBLISH_STATE,
  loadPublishState,
  publishStateFile,
  savePublishState,
} from '../publish-state'
import { makeFixture, type PublishFixture } from './fixture'

let fixture: PublishFixture | undefined

afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

describe('publish state', () => {
  it('round-trips through last-push.json', async () => {
    fixture = await makeFixture({})
    const state = { version: 4, items: { mcp: { selected: true, hash: 'abc' } } }
    await savePublishState({ atlasHome: fixture.atlasHome, state })
    expect(await loadPublishState({ atlasHome: fixture.atlasHome })).toEqual(state)
  })

  it('reads a missing file as empty', async () => {
    fixture = await makeFixture({})
    expect(await loadPublishState({ atlasHome: fixture.atlasHome })).toEqual(EMPTY_PUBLISH_STATE)
  })

  it('reads corrupt or mis-shaped files as empty', async () => {
    fixture = await makeFixture({})
    const file = publishStateFile({ atlasHome: fixture.atlasHome })
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, '{not json')
    expect(await loadPublishState({ atlasHome: fixture.atlasHome })).toEqual(EMPTY_PUBLISH_STATE)
    await writeFile(file, JSON.stringify({ version: 'x', items: 3 }))
    expect(await loadPublishState({ atlasHome: fixture.atlasHome })).toEqual(EMPTY_PUBLISH_STATE)
  })
})
