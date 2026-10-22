import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const storybookRoot = resolve(import.meta.dirname, '..')
const uiSrc = resolve(storybookRoot, '../../packages/ui/src')

function listModules(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => file.replace(/\.tsx$/, ''))
    .sort()
}

function missingStories({
  sourceDir,
  storyDir,
}: {
  sourceDir: string
  storyDir: string
}): string[] {
  return listModules(join(uiSrc, sourceDir)).filter(
    (name) => !existsSync(join(storybookRoot, 'src', storyDir, `${name}.stories.tsx`)),
  )
}

describe('story coverage', () => {
  test('ui has components to cover', () => {
    expect(listModules(join(uiSrc, 'components')).length).toBeGreaterThan(0)
  })

  test('every packages/ui component has a story', () => {
    expect(missingStories({ sourceDir: 'components', storyDir: 'components' })).toEqual([])
  })

  test('every packages/ui AI pattern has a story', () => {
    expect(missingStories({ sourceDir: 'ai', storyDir: 'ai' })).toEqual([])
  })
})
