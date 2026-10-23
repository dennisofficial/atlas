import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const uiSrc = resolve(import.meta.dirname, '..')

function isModule(file: string): boolean {
  if (!file.endsWith('.tsx')) return false
  return !file.endsWith('.stories.tsx')
}

function listModules(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(isModule)
    .map((file) => file.replace(/\.tsx$/, ''))
    .sort()
}

function missingStories(sourceDir: string): string[] {
  const dir = join(uiSrc, sourceDir)
  return listModules(dir).filter((name) => !existsSync(join(dir, `${name}.stories.tsx`)))
}

describe('story coverage', () => {
  test('ui has components to cover', () => {
    expect(listModules(join(uiSrc, 'components')).length).toBeGreaterThan(0)
  })

  test('every packages/ui component has a story next to it', () => {
    expect(missingStories('components')).toEqual([])
  })

  test('every packages/ui AI pattern has a story next to it', () => {
    expect(missingStories('ai')).toEqual([])
  })
})
