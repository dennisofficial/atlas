import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = path.dirname(import.meta.dirname)
const TRIGGER_ROOT = path.join(SRC_ROOT, 'trigger')
const SDK_SCOPES = ['api', '_lib'].map((dir) => path.join(SRC_ROOT, dir))
const SDK_ADAPTER = path.join(SRC_ROOT, '_lib', 'trigger', 'trigger-job-dispatcher.ts')
const SPECIFIER_PATTERN = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

function listTsFiles({ dir }: { dir: string }): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listTsFiles({ dir: full })
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : []
  })
}

function specifiersOf({ file }: { file: string }): string[] {
  return [...readFileSync(file, 'utf8').matchAll(SPECIFIER_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )
}

function relative({ file }: { file: string }): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join('/')
}

function importsWorkerCode({ file, specifier }: { file: string; specifier: string }): boolean {
  if (!specifier.startsWith('.')) return false
  const resolved = path.resolve(path.dirname(file), specifier)
  return resolved === TRIGGER_ROOT || resolved.startsWith(`${TRIGGER_ROOT}${path.sep}`)
}

describe('trigger.dev boundary', () => {
  it('never imports worker code from outside src/trigger', () => {
    const offenders = listTsFiles({ dir: SRC_ROOT })
      .filter((file) => !file.startsWith(`${TRIGGER_ROOT}${path.sep}`))
      .flatMap((file) =>
        specifiersOf({ file })
          .filter((specifier) => importsWorkerCode({ file, specifier }))
          .map((specifier) => `${relative({ file })} -> ${specifier}`),
      )
    expect(offenders, 'API code reaches tasks through a contract and JobDispatcher').toEqual([])
  })

  it('lets only the dispatcher adapter import the trigger.dev SDK in src/api and src/_lib', () => {
    const offenders = SDK_SCOPES.flatMap((dir) => listTsFiles({ dir }))
      .filter((file) => file !== SDK_ADAPTER)
      .filter((file) => specifiersOf({ file }).some((specifier) => specifier.startsWith('@trigger.dev/')))
      .map((file) => relative({ file }))
    expect(offenders, 'inject JobDispatcher instead of calling the SDK').toEqual([])
  })
})
