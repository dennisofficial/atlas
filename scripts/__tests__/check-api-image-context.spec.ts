import { describe, expect, it } from 'bun:test'

import {
  API_IMAGE_IGNORE_PATH,
  apiImageContextProblems,
  type ImageWorkspace,
} from '../check-api-image-context'

const workspaces: readonly ImageWorkspace[] = [
  { dir: 'apps/api', name: '@dltech/atlas-api', dependencies: ['@dltech/atlas-core', 'zod'] },
  { dir: 'apps/daemon', name: '@dltech/atlas-daemon', dependencies: ['@dltech/atlas-sandbox'] },
  { dir: 'packages/core', name: '@dltech/atlas-core', dependencies: [] },
  { dir: 'packages/sandbox', name: '@dltech/atlas-sandbox', dependencies: [] },
  { dir: 'apps/web', name: '@dltech/atlas-web', dependencies: ['@dltech/atlas-core'] },
]

describe('apiImageContextProblems', () => {
  it('accepts an excluded workspace the API does not reach that keeps its manifest', () => {
    expect(
      apiImageContextProblems({
        ignoreLines: ['apps/web/*', '!apps/web/package.json'],
        workspaces,
      }),
    ).toEqual([])
  })

  it('rejects an excluded workspace that the daemon reaches transitively', () => {
    expect(
      apiImageContextProblems({
        ignoreLines: ['packages/sandbox/*', '!packages/sandbox/package.json'],
        workspaces,
      }),
    ).toEqual(['packages/sandbox (@dltech/atlas-sandbox) is in the API image but excluded'])
  })

  it('rejects an excluded workspace whose manifest is dropped from the install', () => {
    expect(apiImageContextProblems({ ignoreLines: ['apps/web/*'], workspaces })).toEqual([
      'apps/web/* has no !apps/web/package.json, so the filtered bun install sees a different workspace set',
    ])
  })

  it('accepts the committed dockerignore', async () => {
    const committed = await Bun.file(
      new URL(`../../${API_IMAGE_IGNORE_PATH}`, import.meta.url),
    ).text()
    expect(committed.split('\n')).toContain('packages/harness/*')
    expect(apiImageContextProblems({ ignoreLines: committed.split('\n'), workspaces })).toEqual([])
  })
})
