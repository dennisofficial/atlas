import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { EProjectSettingsPage } from '../src/fixtures/project-settings'
import { ESettingsPage } from '../src/app/settings/settings-nav'

const SRC = join(import.meta.dir, '..', 'src')
const APP = join(SRC, 'app')
const TITLE_PATTERN = /title:\s*'([^']*)'/

function listStoryFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listStoryFiles(path)
    return name.endsWith('.stories.tsx') ? [path] : []
  })
}

describe('prototype sitemap', () => {
  test.each(Object.values(ESettingsPage))('settings page %s has a story', (page) => {
    expect(existsSync(join(APP, 'settings', `${page}.stories.tsx`))).toBe(true)
  })

  test.each(Object.values(EProjectSettingsPage))(
    'project settings section %s has a story',
    (section) => {
      expect(existsSync(join(APP, 'projects', 'settings', `${section}.stories.tsx`))).toBe(true)
    },
  )

  test('the views directory is gone', () => {
    expect(existsSync(join(SRC, 'views'))).toBe(false)
  })

  test('every prototype story is titled under App/', () => {
    const stories = listStoryFiles(APP)
    expect(stories.length).toBeGreaterThan(0)
    for (const file of stories) {
      const title = TITLE_PATTERN.exec(readFileSync(file, 'utf8'))?.[1]
      expect(title?.startsWith('App/') || title === 'App').toBe(true)
    }
  })
})
