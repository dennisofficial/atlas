import { describe, expect, it } from 'bun:test'

import {
  API_IMAGE_DOCKERFILE_PATH,
  API_IMAGE_IGNORE_PATH,
  apiImageContextProblems,
  bunPinProblems,
  daemonStageProblems,
  type ImageWorkspace,
} from '../check-api-image-context'

const workspaces: readonly ImageWorkspace[] = [
  { dir: 'apps/api', name: '@dltech/atlas-api', dependencies: ['@dltech/atlas-core', 'zod'] },
  { dir: 'apps/daemon', name: '@dltech/atlas-daemon', dependencies: ['@dltech/atlas-sandbox'] },
  { dir: 'packages/core', name: '@dltech/atlas-core', dependencies: [] },
  { dir: 'packages/sandbox', name: '@dltech/atlas-sandbox', dependencies: [] },
  { dir: 'apps/web', name: '@dltech/atlas-web', dependencies: ['@dltech/atlas-core'] },
]

describe('bunPinProblems', () => {
  it('accepts a base image on the pinned bun', () => {
    expect(
      bunPinProblems({
        dockerfile: 'FROM oven/bun:1.4.2-debian AS base\n',
        packageManager: 'bun@1.4.2',
      }),
    ).toEqual([])
  })

  it('rejects a base image that drifted from packageManager', () => {
    expect(
      bunPinProblems({
        dockerfile: 'FROM oven/bun:1.4.1-debian AS base\n',
        packageManager: 'bun@1.4.2',
      }),
    ).toEqual(['apps/api/docker/Dockerfile uses oven/bun:1.4.1 but package.json pins bun@1.4.2'])
  })

  it('rejects a Dockerfile with no oven/bun base', () => {
    expect(bunPinProblems({ dockerfile: 'FROM debian\n', packageManager: 'bun@1.4.2' })).toEqual([
      'apps/api/docker/Dockerfile has no FROM oven/bun:<version>',
    ])
  })
})

describe('daemonStageProblems', () => {
  const stageOf = (copies: readonly string[]): string =>
    [
      'FROM base AS daemon',
      ...copies.map((dir) => `COPY ${dir}/ ${dir}/`),
      'FROM base',
      'COPY . .',
    ].join('\n')

  it('accepts a daemon stage that copies every workspace the daemon reaches', () => {
    expect(
      daemonStageProblems({ dockerfile: stageOf(['apps/daemon', 'packages/sandbox']), workspaces }),
    ).toEqual([])
  })

  it('rejects a daemon stage that misses a workspace the daemon reaches', () => {
    expect(daemonStageProblems({ dockerfile: stageOf(['apps/daemon']), workspaces })).toEqual([
      'the daemon stage does not COPY packages/sandbox/, which @dltech/atlas-daemon depends on',
    ])
  })
})

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

  it('accepts the committed dockerignore and Dockerfile', async () => {
    const dockerfile = await Bun.file(
      new URL(`../../${API_IMAGE_DOCKERFILE_PATH}`, import.meta.url),
    ).text()
    const root: { packageManager: string } = await Bun.file(
      new URL('../../package.json', import.meta.url),
    ).json()
    expect(bunPinProblems({ dockerfile, packageManager: root.packageManager })).toEqual([])

    const committed = await Bun.file(
      new URL(`../../${API_IMAGE_IGNORE_PATH}`, import.meta.url),
    ).text()
    expect(committed.split('\n')).toContain('packages/harness/*')
    expect(apiImageContextProblems({ ignoreLines: committed.split('\n'), workspaces })).toEqual([])
  })
})
