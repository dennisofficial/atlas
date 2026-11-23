import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { CODEX_VERSION } from '../../src/listing/codex-version'

const MODELS_ROOT = new URL('../../', import.meta.url)
const WORKFLOW_PATH = new URL('../../../../.github/workflows/codex-version.yml', import.meta.url)

describe('codex version pin', () => {
  test('CODEX_VERSION is a plain semver triple', () => {
    expect(CODEX_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('the generate script file exists and rewrites CODEX_VERSION in codex-version.ts', async () => {
    const script = await readFile(new URL('scripts/generate-codex-version.ts', MODELS_ROOT), 'utf8')
    expect(script).toContain("'../src/listing/codex-version'")
    expect(script).toContain('CODEX_VERSION')
    expect(script).toContain('openai/codex/releases/latest')
  })

  test('the generate script writes the same file it imports', async () => {
    const script = await readFile(new URL('scripts/generate-codex-version.ts', MODELS_ROOT), 'utf8')
    expect(script).toContain("from '../src/listing/codex-version'")
    expect(script).toContain("new URL('../src/listing/codex-version.ts', import.meta.url)")
  })

  test('the generate script authenticates the releases call so runner IP quota is not shared', async () => {
    const script = await readFile(new URL('scripts/generate-codex-version.ts', MODELS_ROOT), 'utf8')
    expect(script).toContain('process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN')
    expect(script).toContain('Authorization')
  })

  test('package.json wires generate:codex-version to the script', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('package.json', MODELS_ROOT), 'utf8'),
    )
    const scripts = (manifest as { scripts?: Record<string, string> }).scripts
    expect(scripts?.['generate:codex-version']).toBe('bun scripts/generate-codex-version.ts')
  })

  test('the workflow runs the script and diffs the pinned file', async () => {
    const workflow = await readFile(WORKFLOW_PATH, 'utf8')
    expect(workflow).toContain('bun run generate:codex-version')
    expect(workflow).toContain('packages/models/src/listing/codex-version.ts')
    expect(workflow).toContain('codex-version/$version')
    expect(workflow).toContain('fix(models): bump codex client version to $version')
    expect(workflow).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
  })
})
