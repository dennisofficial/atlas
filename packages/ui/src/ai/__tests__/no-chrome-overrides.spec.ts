import { describe, expect, test } from 'bun:test'
import { join, relative } from 'node:path'

import { type ChromeOverride, chromeOverridesIn } from '../../lib/chrome-overrides'

interface AllowedOverride {
  file: string
  component: string
  token: string
  reason: string
}

const ALLOWED: AllowedOverride[] = [
  {
    file: 'checkpoint.tsx',
    component: 'MarkerContent',
    token: 'gap-2',
    reason: 'spaces the consumer-composed icon, label and restore button inside the marker',
  },
  {
    file: 'inline-citation.tsx',
    component: 'HoverCardContent',
    token: 'gap-1',
    reason: 'spaces the children the pattern composes in the hover body',
  },
  {
    file: 'context.tsx',
    component: 'HoverCardContent',
    token: 'gap-3',
    reason: 'spaces the children the pattern composes in the hover body',
  },
]

const SRC_ROOT = join(import.meta.dir, '..', '..')
const AI_ROOT = join(SRC_ROOT, 'ai')

async function scanAiPatterns(): Promise<(ChromeOverride & { file: string })[]> {
  const found: (ChromeOverride & { file: string })[] = []
  const glob = new Bun.Glob('**/*.tsx')
  for await (const path of glob.scan({ cwd: AI_ROOT, absolute: true })) {
    if (path.endsWith('.stories.tsx') || path.includes('__tests__')) continue
    const source = await Bun.file(path).text()
    const overrides = chromeOverridesIn({
      source,
      fileName: path,
      componentSpecifiers: [/^#components\//],
    })
    for (const override of overrides) {
      found.push({ ...override, file: relative(AI_ROOT, path) })
    }
  }
  return found
}

function isAllowed({ item }: { item: ChromeOverride & { file: string } }): boolean {
  return ALLOWED.some(
    (entry) =>
      entry.file === item.file && entry.component === item.component && entry.token === item.token,
  )
}

describe('ai patterns do not restyle design-system components', () => {
  test('no chrome class reaches a DS component outside the allowlist', async () => {
    const found = await scanAiPatterns()
    const violations = found
      .filter((item) => !isAllowed({ item }))
      .map((item) => `src/ai/${item.file}:${item.line} <${item.component}> ${item.token}`)
    expect(violations).toEqual([])
  })

  test('every allowlist entry still matches an override', async () => {
    const found = await scanAiPatterns()
    const stale = ALLOWED.filter(
      (entry) =>
        !found.some(
          (item) =>
            item.file === entry.file &&
            item.component === entry.component &&
            item.token === entry.token,
        ),
    ).map((entry) => `src/ai/${entry.file} <${entry.component}> ${entry.token}`)
    expect(stale).toEqual([])
  })
})
