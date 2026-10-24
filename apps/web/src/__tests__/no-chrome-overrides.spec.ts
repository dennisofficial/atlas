import { describe, expect, test } from 'bun:test'
import { join, relative } from 'node:path'

import { type ChromeOverride, chromeOverridesIn } from '@dltech/atlas-ui/lib/chrome-overrides'

interface AllowedOverride {
  file: string
  component: string
  token: string
  reason: string
}

const ALLOWED: AllowedOverride[] = []

const WEB_SRC = join(import.meta.dir, '..')

async function scanWeb(): Promise<(ChromeOverride & { file: string })[]> {
  const found: (ChromeOverride & { file: string })[] = []
  const glob = new Bun.Glob('**/*.tsx')
  for await (const path of glob.scan({ cwd: WEB_SRC, absolute: true })) {
    if (path.includes('__tests__') || path.endsWith('.stories.tsx')) continue
    const source = await Bun.file(path).text()
    const overrides = chromeOverridesIn({
      source,
      fileName: path,
      componentSpecifiers: [/^@dltech\/atlas-ui\/components\//],
    })
    for (const override of overrides) {
      found.push({ ...override, file: relative(WEB_SRC, path) })
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

describe('web does not restyle design-system components', () => {
  test('no chrome class reaches a DS component outside the allowlist', async () => {
    const found = await scanWeb()
    const violations = found
      .filter((item) => !isAllowed({ item }))
      .map((item) => `apps/web/src/${item.file}:${item.line} <${item.component}> ${item.token}`)
    expect(violations).toEqual([])
  })

  test('every allowlist entry still matches an override', async () => {
    const found = await scanWeb()
    const stale = ALLOWED.filter(
      (entry) =>
        !found.some(
          (item) =>
            item.file === entry.file &&
            item.component === entry.component &&
            item.token === entry.token,
        ),
    ).map((entry) => `apps/web/src/${entry.file} <${entry.component}> ${entry.token}`)
    expect(stale).toEqual([])
  })
})
