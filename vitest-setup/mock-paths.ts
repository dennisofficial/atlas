import { dirname, resolve } from 'node:path'

import type { Plugin } from 'vite'

const MOCK_CALL =
  /(\bvi\s*\.\s*(?:mock|doMock|unmock|doUnmock|importActual|importMock)\s*(?:<[^>()]*>)?\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g

// Vitest 4 finds a vi.mock caller by matching ` at Object.mock` or `mock@` in a stack frame
// (vitest/dist/chunks/vi.*.js getImporter). Bun names that frame neither way, so the importer
// resolves to "" and every relative specifier misses its module. Absolute specifiers need no importer.
export function absoluteMockPaths(): Plugin {
  return {
    name: 'atlas:absolute-mock-paths',
    enforce: 'pre',
    transform(code, id) {
      if (!code.includes('vi.') || id.includes('/node_modules/')) return null
      const from = dirname(id.split('?')[0] ?? id)
      const out = code.replace(
        MOCK_CALL,
        (_match, lead: string, quote: string, specifier: string) =>
          `${lead}${quote}${resolve(from, specifier)}${quote}`,
      )
      return out === code ? null : { code: out, map: null }
    },
  }
}
