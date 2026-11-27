import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createSpawnClassifier } from '../src/spawn'

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function makeDir(files: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'spawn-classifier-')))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

function setup(files: Record<string, string>) {
  const repoRoot = makeDir(files)
  const outside = makeDir({})
  const recorded: string[] = []
  const { classify } = createSpawnClassifier({
    repoRoot,
    recordFile: (path) => recorded.push(path),
  })
  return { repoRoot, outside, recorded, classify }
}

describe('spawn classifier', () => {
  test('a program that reads a relative repo file in a repo cwd is uncacheable', () => {
    const { repoRoot, classify } = setup({ 'package.json': '{}' })
    expect(classify([['cat', 'package.json'], { cwd: repoRoot }]).uncacheable).toBe(true)
  })

  test('an unknown interpreter running a repo file is uncacheable', () => {
    const { repoRoot, classify } = setup({ 'check.py': 'print(1)' })
    expect(classify([['python', 'check.py'], { cwd: repoRoot }]).uncacheable).toBe(true)
  })

  test('an unknown program with only flags in a repo cwd is uncacheable', () => {
    const { repoRoot, classify } = setup({})
    expect(classify([['jq', '.x'], { cwd: repoRoot }]).uncacheable).toBe(true)
  })

  test('a filesystem-free program is cacheable in a repo cwd', () => {
    const { repoRoot, classify } = setup({})
    expect(classify([['echo', 'hi'], { cwd: repoRoot }]).uncacheable).toBe(false)
  })

  test('an unknown program outside the repo naming no repo path is cacheable', () => {
    const { outside, classify } = setup({})
    expect(classify([['git', 'init'], { cwd: outside }]).uncacheable).toBe(false)
    expect(classify([['cat', 'notes.txt'], { cwd: outside }]).uncacheable).toBe(false)
  })

  test('an unknown program outside the repo naming a repo path is uncacheable', () => {
    const { repoRoot, outside, classify } = setup({ 'data.json': '{}' })
    expect(classify([['cat', join(repoRoot, 'data.json')], { cwd: outside }]).uncacheable).toBe(
      true,
    )
  })

  test('a bun script with a traceable graph is cacheable and records its files', () => {
    const { repoRoot, recorded, classify } = setup({
      'main.ts': "import { value } from './dep'\nconsole.log(value)",
      'dep.ts': 'export const value = 1',
    })
    const verdict = classify([['bun', 'main.ts'], { cwd: repoRoot }])
    expect(verdict.uncacheable).toBe(false)
    expect(recorded.sort()).toEqual([join(repoRoot, 'dep.ts'), join(repoRoot, 'main.ts')])
  })

  test('a bun script started through setsid or nohup is classified by the script', () => {
    const { repoRoot, recorded, classify } = setup({
      'main.ts': "import { value } from './dep'\nconsole.log(value)",
      'dep.ts': 'export const value = 1',
    })
    expect(classify([['setsid', 'bun', 'main.ts'], { cwd: repoRoot }]).uncacheable).toBe(false)
    expect(
      classify([['nohup', 'setsid', '-w', 'bun', 'main.ts'], { cwd: repoRoot }]).uncacheable,
    ).toBe(false)
    expect(recorded).toContain(join(repoRoot, 'dep.ts'))
  })

  test('a wrapper keeps an unknown wrapped program uncacheable', () => {
    const { repoRoot, classify } = setup({ 'package.json': '{}' })
    expect(classify([['setsid', 'cat', 'package.json'], { cwd: repoRoot }]).uncacheable).toBe(true)
    expect(classify([['setsid'], { cwd: repoRoot }]).uncacheable).toBe(true)
  })

  test('mkfifo, pgrep and pkill read no repo input', () => {
    const { repoRoot, outside, classify } = setup({})
    expect(classify([['mkfifo', join(outside, 'gate')], { cwd: repoRoot }]).uncacheable).toBe(false)
    expect(classify([['pgrep', '-f', outside], { cwd: repoRoot }]).uncacheable).toBe(false)
    expect(classify([['pkill', '-9', '-f', outside], { cwd: repoRoot }]).uncacheable).toBe(false)
  })

  test('a bun script that cannot be read is uncacheable', () => {
    const { repoRoot, classify } = setup({})
    expect(classify([['bun', 'missing.ts'], { cwd: repoRoot }]).uncacheable).toBe(true)
  })

  test('bun without a script in a repo cwd is uncacheable', () => {
    const { repoRoot, classify } = setup({})
    expect(classify([['bun', 'test'], { cwd: repoRoot }]).uncacheable).toBe(true)
  })
})
