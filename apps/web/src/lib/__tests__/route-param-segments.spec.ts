import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '../..')
const APP = join(SRC, 'app')

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.tsx?$/.test(path) && !path.includes('__tests__'))
    .map((path) => join(SRC, path))
}

function requestedParams(): Set<string> {
  const names = sourceFiles().flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/useRouteParam\('([^']+)'\)/g)].map(
      (match) => match[1] ?? '',
    ),
  )
  return new Set(names)
}

function dynamicSegments(): Set<string> {
  const segments = readdirSync(APP, { recursive: true, encoding: 'utf8' }).flatMap((path) =>
    path.split(/[\\/]/).flatMap((part) => {
      const match = /^\[(\w+)\]$/.exec(part)
      return match?.[1] === undefined ? [] : [match[1]]
    }),
  )
  return new Set(segments)
}

describe('useRouteParam names', () => {
  test('every requested param is a dynamic segment under src/app', () => {
    const segments = dynamicSegments()
    const missing = [...requestedParams()].filter((name) => !segments.has(name))
    expect(missing).toEqual([])
  })
})
