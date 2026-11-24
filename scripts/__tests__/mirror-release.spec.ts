import { describe, expect, it } from 'bun:test'

import {
  droppedNames,
  objectKeyOf,
  objectListKeyOf,
  parseMirrorArgs,
  publicUrlOf,
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
