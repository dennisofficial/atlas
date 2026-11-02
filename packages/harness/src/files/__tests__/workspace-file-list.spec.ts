import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'bun:test'

import { runGit } from '../../workspace/run-git'
import { FileBrowser } from '../file-browser'
import { listWorkspaceFiles } from '../workspace-file-list'

let root: string

const write = (at: string): void => {
  mkdirSync(join(root, at, '..'), { recursive: true })
  writeFileSync(join(root, at), 'x')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'atlas-list-'))
})

describe('listWorkspaceFiles', () => {
  it('lists tracked and untracked files but not gitignored ones in a git repo', async () => {
    await runGit({ args: ['init', '-q'], cwd: root })
    write('.gitignore')
    writeFileSync(join(root, '.gitignore'), 'dist/\n')
    write('src/a.ts')
    write('dist/out.js')
    await runGit({ args: ['add', 'src/a.ts'], cwd: root })
    write('src/b.ts')

    const files = await listWorkspaceFiles({ root })
    expect(files.sort()).toEqual(['.gitignore', 'src/a.ts', 'src/b.ts'])
  })

  it('walks the tree outside a git repo, skipping node_modules and .git', async () => {
    write('src/a.ts')
    write('node_modules/pkg/index.js')
    write('.git/config')

    expect(await listWorkspaceFiles({ root })).toEqual(['src/a.ts'])
  })
})

describe('FileBrowser.search', () => {
  it('ranks matches, caches the listing, and refreshes after forget', async () => {
    write('src/app.ts')
    write('docs/readme.md')
    const browser = new FileBrowser({ root })

    const first = await browser.search({ query: 'app', limit: 10 })
    expect(first.paths.map((match) => match.path)).toEqual(['src/app.ts'])
    expect(first.truncated).toBe(false)

    write('src/app2.ts')
    expect((await browser.search({ query: 'app', limit: 10 })).paths).toHaveLength(1)

    browser.forget()
    expect((await browser.search({ query: 'app', limit: 10 })).paths).toHaveLength(2)
  })

  it('answers nothing for a blank query', async () => {
    write('a.ts')
    expect(await new FileBrowser({ root }).search({ query: ' ', limit: 10 })).toEqual({
      paths: [],
      truncated: false,
    })
  })

  it('leaves out files the sandbox cannot reach', async () => {
    write('in/a.ts')
    write('out/a.ts')
    const browser = new FileBrowser({ root, reachableRoots: () => [join(root, 'in')] })
    const reply = await browser.search({ query: 'a.ts', limit: 10 })
    expect(reply.paths.map((match) => match.path)).toEqual(['in/a.ts'])
  })
})
