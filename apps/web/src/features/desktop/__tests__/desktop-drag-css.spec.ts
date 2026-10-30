import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DESKTOP_DRAG_CSS } from '../desktop-drag-css'

const rewriterPath = join(
  process.env.HOME ?? '',
  '.hutch/releases/electrobun/2.0.5/linux-x64/api/preload/dragRegions.ts',
)
const rewriterPresent = Bun.file(rewriterPath).size > 0
const builtChunks = (() => {
  try {
    const dir = join(import.meta.dir, '../../../../out/_next/static/chunks')
    return readdirSync(dir)
      .filter((name) => name.endsWith('.css'))
      .map((name) => readFileSync(join(dir, name), 'utf8'))
  } catch {
    return []
  }
})()

describe('DESKTOP_DRAG_CSS', () => {
  it('has no quotes or backslashes the Electrobun rewriter would desync on', () => {
    expect(DESKTOP_DRAG_CSS).not.toMatch(/["'\\]/)
  })

  it('precedes every app-region declaration with a brace or semicolon', () => {
    const declarations = DESKTOP_DRAG_CSS.match(/-webkit-app-region/g) ?? []
    const preceded = DESKTOP_DRAG_CSS.match(/[{;]-webkit-app-region:/g) ?? []
    expect(declarations.length).toBeGreaterThan(0)
    expect(preceded.length).toBe(declarations.length)
  })

  it.skipIf(!rewriterPresent)('is fully rewritten by the real Electrobun rewriter', async () => {
    const { rewriteAppRegionDeclarations } = await import(rewriterPath)
    const rewritten: string = rewriteAppRegionDeclarations(DESKTOP_DRAG_CSS)
    expect(rewritten).not.toContain('-webkit-app-region')
    expect(rewritten.match(/--electrobun-app-region/g)?.length).toBe(
      DESKTOP_DRAG_CSS.match(/-webkit-app-region/g)?.length,
    )
  })

  it.skipIf(!rewriterPresent || builtChunks.length === 0)(
    'leaves no app-region rules in the bundled CSS',
    async () => {
      const { rewriteAppRegionDeclarations } = await import(rewriterPath)
      for (const chunk of builtChunks) expect(chunk).not.toContain('app-region')
      for (const chunk of builtChunks) expect(rewriteAppRegionDeclarations(chunk)).toBe(chunk)
    },
  )
})
