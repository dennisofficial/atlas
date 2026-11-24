import { describe, expect, it } from 'bun:test'

import manifest from '../../../package.json'
import { apiVersion } from './api-version'

describe('apiVersion', () => {
  it('prefers the deploy stamp', () => {
    expect(
      apiVersion({
        env: {
          ATLAS_APP_VERSION: '2026.11.20',
          RENDER_GIT_COMMIT: 'abcdef1234567890',
          VERCEL_GIT_COMMIT_SHA: 'fedcba9876543210',
        },
      }),
    ).toBe('2026.11.20')
  })

  it('shortens a full commit sha in the deploy stamp', () => {
    expect(apiVersion({ env: { ATLAS_APP_VERSION: 'a'.repeat(40) } })).toBe('aaaaaaa')
  })

  it('keeps a deploy stamp that is not a commit sha', () => {
    expect(apiVersion({ env: { ATLAS_APP_VERSION: 'a1b2c3d' } })).toBe('a1b2c3d')
  })

  it('falls back to the Render commit', () => {
    expect(apiVersion({ env: { RENDER_GIT_COMMIT: 'abcdef1234567890' } })).toBe('abcdef1')
  })

  it('falls back to the Vercel commit', () => {
    expect(apiVersion({ env: { VERCEL_GIT_COMMIT_SHA: 'fedcba9876543210' } })).toBe('fedcba9')
  })

  it('falls back to the manifest version', () => {
    expect(apiVersion({ env: {} })).toBe(manifest.version)
  })

  it('ignores an empty stamp', () => {
    expect(apiVersion({ env: { ATLAS_APP_VERSION: '' } })).toBe(manifest.version)
  })
})
