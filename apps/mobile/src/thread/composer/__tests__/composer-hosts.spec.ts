import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const COMPOSER_DIRS = [join(import.meta.dir, '..'), join(import.meta.dir, '..', 'dictation')]

const iosFilesOf = (dir: string) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ios.tsx'))
    .map((name) => ({ name, source: readFileSync(join(dir, name), 'utf8') }))

describe('SwiftUI hosts in the composer row', () => {
  it('ignore the keyboard safe area, so the keyboard never lifts their buttons out of the row', () => {
    const hosts = COMPOSER_DIRS.flatMap(iosFilesOf).filter(({ source }) => source.includes('<Host'))

    expect(hosts.length).toBeGreaterThan(0)
    for (const { name, source } of hosts) {
      const tags = source.match(/<Host\b[^>]*>/g) ?? []
      for (const tag of tags)
        expect({ name, tag }).toEqual({
          name,
          tag: expect.stringContaining('ignoreSafeArea="keyboard"'),
        })
    }
  })
})
