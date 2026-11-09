import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const APP_DIR = join(import.meta.dir, '..')

async function appSources(): Promise<{ path: string; text: string }[]> {
  const entries = await readdir(APP_DIR, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .filter((entry) => !entry.parentPath.includes('__tests__'))
    .map((entry) => join(entry.parentPath, entry.name))
  return Promise.all(
    files.map(async (path) => ({
      path: path.slice(APP_DIR.length + 1),
      text: await Bun.file(path).text(),
    })),
  )
}

const sources = await appSources()
const routeHandlers = sources.filter((source) => /(^|\/)route\.ts$/.test(source.path))
const pages = sources.filter((source) => /(^|\/)(page|layout)\.tsx$/.test(source.path))

describe('the app is a router, not a backend', () => {
  test('finds the app tree', () => {
    expect(sources.length).toBeGreaterThan(20)
    expect(pages.length).toBeGreaterThan(20)
  })

  test('every route handler is prerendered', () => {
    expect(routeHandlers.length).toBeGreaterThan(0)
    for (const handler of routeHandlers) {
      expect({
        path: handler.path,
        static: handler.text.includes("dynamic = 'force-static'"),
      }).toEqual({ path: handler.path, static: true })
    }
  })

  test('no server actions', () => {
    const offenders = sources.filter((source) => source.text.includes("'use server'"))
    expect(offenders.map((source) => source.path)).toEqual([])
  })

  test('no request-time Next APIs', () => {
    const forbidden = [
      /from 'next\/headers'/,
      /\bcookies\(\)/,
      /\bheaders\(\)/,
      /import\s*\{[^}]*\bredirect\b[^}]*\}\s*from 'next\/navigation'/,
      /import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from 'next\/navigation'/,
    ]
    const offenders = sources.filter((source) =>
      forbidden.some((pattern) => pattern.test(source.text)),
    )
    expect(offenders.map((source) => source.path)).toEqual([])
  })

  test('no page or layout awaits data', () => {
    const offenders = pages.filter((page) => page.text.includes('export default async function'))
    expect(offenders.map((page) => page.path)).toEqual([])
  })
})
