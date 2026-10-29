import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'bun:test'

import { userPluginsDirectory } from '../../settings/paths'
import { userTrustedRepos } from '../../composition/plugin-loading'
import { installPluginApi } from '../install-api'
import { readRepoPlugins } from '../repo-plugins'

beforeAll(() => {
  installPluginApi()
})

const sourceFor = (id: string): string => `
import { definePlugin } from 'atlas'

export default definePlugin({ id: '${id}', register: () => ({}) })
`

const plant = (args: { directory: string; name: string; id: string }): void => {
  mkdirSync(args.directory, { recursive: true })
  writeFileSync(join(args.directory, args.name), sourceFor(args.id))
}

const checkout = (args: { origin?: string } = {}): string => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-trust-'))
  plant({
    directory: join(root, '.atlas', 'plugins'),
    name: 'mine.ts',
    id: 'project-one',
  })
  if (args.origin !== undefined) {
    Bun.spawnSync(['git', 'init', '-q'], { cwd: root })
    Bun.spawnSync(['git', 'remote', 'add', 'origin', args.origin], {
      cwd: root,
    })
  }
  return root
}

const idsOf = (read: Awaited<ReturnType<typeof readRepoPlugins>>): string[] =>
  read.plugins.map((entry) => entry.plugin.id)

describe('project plugin trust', () => {
  it('withholds project plugins from an untrusted repository and names them', async () => {
    const cwd = checkout()
    const read = await readRepoPlugins({ cwd, trustedRepos: '' })

    expect(idsOf(read)).toEqual([])
    expect(read.withheld).toEqual(['mine'])
    expect(read.trustKey).toBe(cwd)
  })

  it('loads project plugins when the absolute path is trusted', async () => {
    const cwd = checkout()
    const read = await readRepoPlugins({
      cwd,
      trustedRepos: `github.com/a/b, ${cwd}`,
    })

    expect(idsOf(read)).toEqual(['project-one'])
    expect(read.withheld).toEqual([])
  })

  it('trusts by normalized origin so another checkout path of the same repo loads', async () => {
    const cwd = checkout({ origin: 'git@github.com:Acme/Widget.git' })
    const read = await readRepoPlugins({
      cwd,
      trustedRepos: 'github.com/acme/widget',
    })

    expect(read.trustKey).toBe('github.com/Acme/Widget')
    expect(idsOf(read)).toEqual(['project-one'])
  })

  it('always loads user plugins', async () => {
    plant({
      directory: userPluginsDirectory(),
      name: 'user.ts',
      id: 'user-one',
    })
    const read = await readRepoPlugins({ cwd: checkout(), trustedRepos: '' })

    expect(idsOf(read)).toEqual(['user-one'])
  })
})

describe('trust list source', () => {
  it('reads only the user document', () => {
    expect(userTrustedRepos({ values: { 'plugins.trustedRepos': 'a/b' } })).toBe('a/b')
    expect(userTrustedRepos({ values: {} })).toBe('')
  })
})
