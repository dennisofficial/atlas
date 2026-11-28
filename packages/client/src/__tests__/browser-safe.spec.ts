import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { browserSafetyViolations } from './browser-safe-imports'

const SRC = join(import.meta.dir, '..')
const LOOPBACK = join(SRC, 'loopback')

const loopbackImportsOf = (args: { source: string; file: string }): string[] =>
  [...args.source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1] ?? '')
    .filter(
      (specifier) =>
        specifier === '@dltech/atlas-client/loopback' ||
        (specifier.startsWith('.') &&
          relative(SRC, resolve(dirname(args.file), specifier)).split(sep)[0] === 'loopback'),
    )

const sourceFilesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFilesUnder(path)
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : []
  })

describe('browserSafetyViolations', () => {
  it.each([
    ["import { x } from 'node:fs'", 'node: import'],
    ["import { x } from 'bun'", 'bun import'],
    ["import { test } from 'bun:test'", 'bun import'],
    ['const file = Bun.file(path)', 'Bun global'],
    ['const home = process.env.HOME', 'process global'],
    ["import { x } from '@dltech/atlas-harness'", 'harness import'],
    ["import { x } from '@dltech/atlas-wire'", 'wire root import'],
    ["import { x } from '@vercel/sandbox'", '@vercel/sandbox import'],
    ["import { x } from './sibling.js'", 'relative .js import'],
    ["export * from '../parent.js'", 'relative .js import'],
  ])('flags %s', (source, rule) => {
    expect(browserSafetyViolations(source).map((violation) => violation.rule)).toContain(rule)
  })

  it('accepts the browser-safe imports', () => {
    const source = [
      "import { z } from 'zod'",
      "import { toThreadId } from '@dltech/atlas-core'",
      "import { EServeFrame } from '@dltech/atlas-wire/web'",
      "import { x } from './sibling'",
    ].join('\n')
    expect(browserSafetyViolations(source)).toEqual([])
  })

  it('reports the line of a violation', () => {
    expect(browserSafetyViolations("import { z } from 'zod'\nconst a = process.env")).toEqual([
      { rule: 'process global', line: 2 },
    ])
  })
})

describe('the client package', () => {
  it('keeps every portable module browser-safe and outside the Bun-only subpath', () => {
    const offences = sourceFilesUnder(SRC)
      .filter((file) => relative(SRC, file).split(sep)[0] !== 'loopback')
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        return [
          ...browserSafetyViolations(source).map(
            ({ rule, line }) => `${relative(SRC, file)}:${line} ${rule}`,
          ),
          ...loopbackImportsOf({ source, file }).map(
            (specifier) => `${relative(SRC, file)} imports ${specifier}`,
          ),
        ]
      })
    expect(offences).toEqual([])
  })

  it('permits only Bun globals in the dedicated loopback transport', () => {
    const offences = sourceFilesUnder(LOOPBACK).flatMap((file) =>
      browserSafetyViolations(readFileSync(file, 'utf8')).filter(
        ({ rule }) => rule !== 'Bun global',
      ),
    )
    expect(offences).toEqual([])
  })

  it.each([
    ["import { start } from '../loopback'", ['../loopback']],
    ["export * from '../loopback/loopback-server'", ['../loopback/loopback-server']],
    ["const listener = import('@dltech/atlas-client/loopback')", ['@dltech/atlas-client/loopback']],
    ["import { x } from '../account'", []],
  ])('detects a portable entry point reaching the Bun-only transport: %s', (source, expected) => {
    expect(loopbackImportsOf({ source, file: join(SRC, 'account', 'index.ts') })).toEqual(expected)
  })
})

describe('the protocol root', () => {
  it('is browser-safe, so the stream client can import it', () => {
    const PROTOCOL_SRC = join(import.meta.dir, '..', '..', '..', 'protocol', 'src')
    const offences = sourceFilesUnder(PROTOCOL_SRC)
      .filter((file) => !relative(PROTOCOL_SRC, file).startsWith('engine'))
      .filter((file) => !relative(PROTOCOL_SRC, file).startsWith('testing'))
      .flatMap((file) =>
        browserSafetyViolations(readFileSync(file, 'utf8')).map(
          ({ rule, line }) => `${relative(PROTOCOL_SRC, file)}:${line} ${rule}`,
        ),
      )
    expect(offences).toEqual([])
  })
})
