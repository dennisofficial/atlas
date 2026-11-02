import { describe, expect, it } from 'bun:test'

import { languageOfPath } from '../language-of-path'

describe('languageOfPath', () => {
  it('maps extensions and well-known file names', () => {
    expect(languageOfPath('src/a.tsx')).toBe('tsx')
    expect(languageOfPath('docs/README.MD')).toBe('markdown')
    expect(languageOfPath('infra/Dockerfile')).toBe('dockerfile')
  })

  it('returns null for unknown or extensionless files', () => {
    expect(languageOfPath('LICENSE')).toBeNull()
    expect(languageOfPath('a.unknownext')).toBeNull()
  })
})
