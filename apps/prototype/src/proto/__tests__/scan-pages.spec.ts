import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isRedirectOnly, scanPageDirs } from '../scan-pages'

const root = mkdtempSync(join(tmpdir(), 'proto-scan-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function page({ dir, source }: { dir: string; source: string }) {
  mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, dir, 'page.tsx'), source)
}

const RENDERS = 'export default function P() { return <div /> }'
const REDIRECTS = "export default function P() { redirect('/x') }"

page({ dir: '(public)/sign-in', source: RENDERS })
page({ dir: '(private)/(shell)/threads/[threadId]', source: RENDERS })
page({ dir: '(private)/(shell)/old', source: REDIRECTS })
page({ dir: 'api/health', source: RENDERS })
page({ dir: 'proto', source: RENDERS })
page({ dir: '_private/hidden', source: RENDERS })

describe('scanPageDirs', () => {
  test('keeps route groups and dynamic segments in the disk path', () => {
    expect(
      scanPageDirs(root)
        .map((segments) => segments.join('/'))
        .sort(),
    ).toEqual(['(private)/(shell)/threads/[threadId]', '(public)/sign-in'])
  })
})

describe('isRedirectOnly', () => {
  test('flags pages that only redirect', () => {
    expect(isRedirectOnly(REDIRECTS)).toBe(true)
    expect(isRedirectOnly(RENDERS)).toBe(false)
    expect(isRedirectOnly("redirect('/a'); return <div />")).toBe(false)
  })
})
