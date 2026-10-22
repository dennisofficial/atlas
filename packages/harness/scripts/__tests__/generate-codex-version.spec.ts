import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

import { CODEX_VERSION } from '../../src/providers/codex-version'

const HARNESS_ROOT = new URL('../../', import.meta.url)
const WORKFLOW_PATH = new URL('../../../../.github/workflows/codex-version.yml', import.meta.url)

describe('codex version pin', () => {
  test('CODEX_VERSION is a plain semver triple', () => {
    expect(CODEX_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test('the generate script file exists and rewrites CODEX_VERSION in codex-version.ts', async () => {
    const script = await readFile(new URL('scripts/generate-codex-version.ts', HARNESS_ROOT), 'utf8')
    expect(script).toContain("'../src/providers/codex-version'")
    expect(script).toContain('CODEX_VERSION')
    expect(script).toContain('openai/codex/releases/latest')
  })

  test('package.json wires generate:codex-version to the script', async () => {
    const manifest: unknown = JSON.parse(await readFile(new URL('package.json', HARNESS_ROOT), 'utf8'))
    const scripts = (manifest as { scripts?: Record<string, string> }).scripts
    expect(scripts?.['generate:codex-version']).toBe('bun scripts/generate-codex-version.ts')
  })

  test('the workflow runs the script and diffs the pinned file', async () => {
    const workflow = await readFile(WORKFLOW_PATH, 'utf8')
    expect(workflow).toContain('bun run generate:codex-version')
    expect(workflow).toContain('packages/harness/src/providers/codex-version.ts')
    expect(workflow).toContain('codex-version/$version')
    expect(workflow).toContain('fix(harness): bump codex client version to $version')
  })
})
