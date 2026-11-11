import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'bun:test'

import { selectFiles } from '../index'

import { git, removeTempDirs, tempDir, writePath } from './temp'

afterAll(removeTempDirs)

const gitFixture = (): string => {
  const root = tempDir()
  writePath({ root, path: '.gitignore', contents: 'node_modules/\ndist/\n*.log\n!/.env.example\n' })
  writePath({
    root,
    path: 'artifact.json',
    contents: JSON.stringify({
      publish: { include: ['trace.log', 'node_modules/**'], exclude: ['src/secret.js'] },
    }),
  })
  writePath({ root, path: 'index.html', contents: '<html></html>' })
  writePath({ root, path: 'src/app.js', contents: 'console.log(1)' })
  writePath({ root, path: 'src/secret.js', contents: 'const key = 1' })
  writePath({ root, path: '.env.example', contents: 'TOKEN=' })
  writePath({ root, path: 'stale.html', contents: 'deleted from disk' })
  git({ dir: root, argv: ['init', '-q'] })
  git({ dir: root, argv: ['add', '-A'] })
  writePath({ root, path: '.env.local', contents: 'TOKEN=secret' })
  writePath({ root, path: 'trace.log', contents: 'kept by publish.include' })
  writePath({ root, path: 'debug.log', contents: 'ignored' })
  writePath({ root, path: 'dist/out.js', contents: 'built output' })
  writePath({ root, path: 'node_modules/left-pad/index.js', contents: 'module.exports = 1' })
  writePath({ root, path: 'notes.md', contents: 'untracked' })
  rmSync(join(root, 'stale.html'))
  return root
}

const bareFixture = (): string => {
  const root = tempDir()
  writePath({ root, path: '.gitignore', contents: 'node_modules/\n*.log\n' })
  writePath({
    root,
    path: 'artifact.json',
    contents: JSON.stringify({ publish: { include: ['secret.log'] } }),
  })
  writePath({ root, path: 'index.html', contents: '<html></html>' })
  writePath({ root, path: 'src/app.js', contents: 'console.log(1)' })
  writePath({ root, path: 'debug.log', contents: 'ignored' })
  writePath({ root, path: 'secret.log', contents: 'kept by publish.include' })
  writePath({ root, path: '.env.local', contents: 'TOKEN=secret' })
  writePath({ root, path: 'node_modules/left-pad/index.js', contents: 'module.exports = 1' })
  writePath({ root, path: 'nested/.gitignore', contents: 'skip.js\n' })
  writePath({ root, path: 'nested/skip.js', contents: 'ignored by the nested file' })
  writePath({ root, path: 'nested/keep.js', contents: 'kept' })
  return root
}

describe('selectFiles inside a work tree', () => {
  it('selects git\u2019s answer plus the policy, minus the hard exclusions', async () => {
    expect(await selectFiles({ dir: gitFixture() })).toEqual([
      '.env.example',
      '.gitignore',
      'artifact.json',
      'index.html',
      'notes.md',
      'src/app.js',
      'trace.log',
    ])
  })

  it('applies the defaults when the directory has no artifact.json', async () => {
    const root = tempDir()
    writePath({ root, path: '.gitignore', contents: '*.log\n' })
    writePath({ root, path: 'index.html', contents: '<html></html>' })
    writePath({ root, path: 'src/app.js', contents: 'console.log(1)' })
    writePath({ root, path: '.env.local', contents: 'TOKEN=secret' })
    writePath({ root, path: 'debug.log', contents: 'ignored' })
    git({ dir: root, argv: ['init', '-q'] })
    git({ dir: root, argv: ['add', '-A'] })
    expect(await selectFiles({ dir: root })).toEqual(['.gitignore', 'index.html', 'src/app.js'])
  })

  it('reports each path once and relative to the directory', async () => {
    const paths = await selectFiles({ dir: gitFixture() })
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every((path) => !path.startsWith('/') && !path.startsWith('.'))).toBe(false)
    expect(paths.every((path) => !path.includes('..'))).toBe(true)
  })
})

describe('selectFiles outside a work tree', () => {
  it('falls back to gitignore semantics with the same policy', async () => {
    expect(await selectFiles({ dir: bareFixture() })).toEqual([
      '.gitignore',
      'artifact.json',
      'index.html',
      'nested/.gitignore',
      'nested/keep.js',
      'secret.log',
      'src/app.js',
    ])
  })

  it('honours nested .gitignore files', async () => {
    expect(await selectFiles({ dir: bareFixture() })).not.toContain('nested/skip.js')
  })

  it('never selects a hard-excluded path', async () => {
    const paths = await selectFiles({ dir: bareFixture() })
    expect(paths).not.toContain('.env.local')
    expect(paths.some((path) => path.startsWith('node_modules/'))).toBe(false)
  })
})
