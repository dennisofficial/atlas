import { mkdtempSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { materializePluginTypes, pluginTypesPath } from '../materialize'

const homeDirectory = (): string => mkdtempSync(join(tmpdir(), 'atlas-types-home-'))

describe('materializePluginTypes', () => {
  it('writes the embedded text to <home>/types/atlas.d.ts', async () => {
    const home = homeDirectory()

    const path = await materializePluginTypes({
      home,
      text: 'declare module "atlas" {}\n',
    })

    expect(path).toBe(pluginTypesPath(home))
    expect(await Bun.file(path).text()).toBe('declare module "atlas" {}\n')
  })

  it('replaces a stale file and leaves a current one untouched', async () => {
    const home = homeDirectory()
    const path = await materializePluginTypes({ home, text: 'old\n' })

    await materializePluginTypes({ home, text: 'new\n' })
    expect(await Bun.file(path).text()).toBe('new\n')

    utimesSync(path, 1, 1)
    await materializePluginTypes({ home, text: 'new\n' })
    expect((await Bun.file(path).stat()).mtimeMs).toBe(1000)
  })
})
