import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shippedEntries = ['main.js', 'panes.js']

function fileEntries() {
  const lines = readFileSync(join(root, 'electron-builder.yml'), 'utf8').split('\n')
  const start = lines.findIndex((line) => line.trim() === 'files:')
  const entries = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !line.trimStart().startsWith('-')) break
    const match = line.match(/^\s*-\s*'?([^'\s]+)'?\s*$/)
    if (match?.[1] !== undefined) entries.push(match[1])
  }
  return entries
}

function localImports(file) {
  const text = readFileSync(join(root, file), 'utf8')
  const names = new Set()
  for (const match of text.matchAll(/(?:from|require\s*\()\s*'\.\/([^']+)'/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return names
}

const isShipped = (name) =>
  fileEntries().some((entry) =>
    entry.includes('*') ? name.startsWith(entry.slice(0, entry.indexOf('*'))) : entry === name,
  )

describe('the packaged app ships every module it imports', () => {
  test('every local import of main.js and panes.js is listed in electron-builder files', () => {
    const missing = shippedEntries
      .flatMap((file) => [...localImports(file)])
      .filter((name) => !isShipped(name))
    expect(missing).toEqual([])
  })

  test('imports are found at all, so the guard cannot pass vacuously', () => {
    expect(localImports('main.js').size).toBeGreaterThan(0)
  })
})
