import type { DirectoryEntry } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { cdQueryOf, completedCdArgument, openCdMenu } from '../cd-menu-model'
import type { FileMenuState } from '../file-menu-model'

const file = (name: string): DirectoryEntry => ({ name, isDirectory: false })
const folder = (name: string): DirectoryEntry => ({ name, isDirectory: true })

const LEVEL: readonly DirectoryEntry[] = [folder('apps'), folder('packages'), file('README.md')]

const opened = (args: {
  text: string
  entries?: readonly DirectoryEntry[]
}): FileMenuState | null => {
  const query = cdQueryOf(args.text)
  if (query === null) return null
  return openCdMenu({ query, entries: args.entries ?? LEVEL })
}

const menuFor = (args: { text: string; entries?: readonly DirectoryEntry[] }): FileMenuState => {
  const state = opened(args)
  if (state === null) throw new Error('expected an open menu')
  return state
}

describe('cdQueryOf', () => {
  it('reads the empty argument right after the command', () => {
    expect(cdQueryOf('/cd ')).toEqual({ directory: '', fragment: '' })
  })

  it('reads a fragment being typed', () => {
    expect(cdQueryOf('/cd app')).toEqual({ directory: '', fragment: 'app' })
  })

  it('reads a directory already stepped into', () => {
    expect(cdQueryOf('/cd ../other-repo/')).toEqual({ directory: '../other-repo/', fragment: '' })
    expect(cdQueryOf('/cd ~/Developer/cub')).toEqual({
      directory: '~/Developer/',
      fragment: 'cub',
    })
  })

  it('stays quiet for the bare command, other commands and prose', () => {
    expect(cdQueryOf('/cd')).toBeNull()
    expect(cdQueryOf('/container docker')).toBeNull()
    expect(cdQueryOf('fix the build')).toBeNull()
  })

  it('stays quiet once the argument holds a space, like a mention would', () => {
    expect(cdQueryOf('/cd my dir')).toBeNull()
  })
})

describe('openCdMenu', () => {
  it('offers only directories, since files cannot be moved into', () => {
    expect(menuFor({ text: '/cd ' }).matches).toEqual([folder('apps'), folder('packages')])
  })

  it('narrows the level to the fragment typed under it', () => {
    expect(menuFor({ text: '/cd app' }).matches).toEqual([folder('apps')])
  })

  it('stays shut when nothing matches and when the level holds no directories', () => {
    expect(opened({ text: '/cd zzz' })).toBeNull()
    expect(opened({ text: '/cd ', entries: [file('README.md')] })).toBeNull()
  })
})

describe('completedCdArgument', () => {
  it('completes the fragment into a directory spelling that stays open for the next level', () => {
    const text = '/cd app'
    expect(completedCdArgument({ text, state: menuFor({ text }) })).toBe('/cd apps/')
  })

  it('keeps the directory spelling the developer wrote, tilde and all', () => {
    const text = '/cd ~/Developer/c'
    const state = menuFor({ text, entries: [folder('comp-v3')] })
    expect(completedCdArgument({ text, state })).toBe('/cd ~/Developer/comp-v3/')
  })
})
