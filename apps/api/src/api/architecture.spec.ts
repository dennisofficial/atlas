import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Layer = 'platform' | 'cloud'

const LAYERS: readonly Layer[] = ['platform', 'cloud']
const INFRA_DIRS = ['_core', '_lib', '_module', 'db']

const FORBIDDEN_TARGETS: Record<Layer, readonly Layer[]> = {
  platform: ['cloud'],
  cloud: [],
}

const API_ROOT = __dirname
const SRC_ROOT = path.dirname(API_ROOT)

// Edges that existed when the layers were drawn (Phase 0). Each one is real
// module wiring, not an import-path accident; later phases burn this list down.
// Removing an edge means deleting its entry here — stale entries fail the suite.
const GRANDFATHERED = new Set([
  'platform/accounts/accounts.module.ts -> ../../cloud/secrets/secrets.module',
  'platform/accounts/sandbox-broker.controller.ts -> ../../cloud/secrets/secrets.types',
  'platform/accounts/sandbox-broker.service.spec.ts -> ../../cloud/secrets/secrets.service',
  'platform/accounts/sandbox-broker.service.ts -> ../../cloud/secrets/secrets.service',
  'platform/accounts/sandbox-broker.service.ts -> ../../cloud/secrets/secrets.types',
  'platform/sandboxes/git-credentials.spec.ts -> ../../cloud/github/github.service',
  'platform/sandboxes/git-credentials.ts -> ../../cloud/github/github.service',
  'platform/sandboxes/sandboxes.controller.ts -> ../../cloud/context-archive/context-archive-http',
  'platform/sandboxes/sandboxes.module.ts -> ../../cloud/context-archive/context-archive.module',
  'platform/sandboxes/sandboxes.module.ts -> ../../cloud/github/github.module',
  'platform/sandboxes/sandboxes.service.spec.ts -> ../../cloud/context-archive/context-archive-limits',
  'platform/sandboxes/sandboxes.service.spec.ts -> ../../cloud/context-archive/context-archive.store',
  'platform/sandboxes/sandboxes.service.spec.ts -> ../../cloud/github/github.service',
  'platform/sandboxes/sandboxes.service.ts -> ../../cloud/context-archive/context-archive-limits',
  'platform/sandboxes/sandboxes.service.ts -> ../../cloud/context-archive/context-archive.store',
])

interface Violation {
  file: string
  line: number
  source: string
  specifier: string
}

const keyOf = ({ file, specifier }: { file: string; specifier: string }): string =>
  `${file} -> ${specifier}`

function listTsFiles({ dir }: { dir: string }): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listTsFiles({ dir: full }))
      continue
    }
    if (entry.name.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

const SPECIFIER_PATTERN = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

function specifiersOf({ file }: { file: string }): { specifier: string; line: number }[] {
  const lines = readFileSync(file, 'utf8').split('\n')
  const found: { specifier: string; line: number }[] = []
  lines.forEach((text, index) => {
    for (const match of text.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1]
      if (specifier !== undefined) {
        found.push({ specifier, line: index + 1 })
      }
    }
  })
  return found
}

function targetLayerOf({
  specifier,
  fromFile,
}: {
  specifier: string
  fromFile: string
}): Layer | null {
  if (specifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(fromFile), specifier)
    const first = path.relative(API_ROOT, resolved).split(path.sep)[0]
    return LAYERS.includes(first as Layer) ? (first as Layer) : null
  }
  const match = /(?:^|\/)api\/(platform|cloud)(?:\/|$)/.exec(specifier)
  return match ? (match[1] as Layer) : null
}

function collectLayerViolations(): Violation[] {
  const violations: Violation[] = []
  for (const layer of LAYERS) {
    const files = listTsFiles({ dir: path.join(API_ROOT, layer) })
    for (const file of files) {
      const relFile = path.relative(API_ROOT, file).split(path.sep).join('/')
      for (const { specifier, line } of specifiersOf({ file })) {
        const target = targetLayerOf({ specifier, fromFile: file })
        if (target !== null && FORBIDDEN_TARGETS[layer].includes(target)) {
          violations.push({
            file: relFile,
            line,
            source: readLine({ file, line }),
            specifier,
          })
        }
      }
    }
  }
  return violations
}

function collectInfraViolations(): Violation[] {
  const violations: Violation[] = []
  for (const dir of INFRA_DIRS) {
    const files = listTsFiles({ dir: path.join(SRC_ROOT, dir) })
    for (const file of files) {
      const relFile = path.relative(SRC_ROOT, file).split(path.sep).join('/')
      for (const { specifier, line } of specifiersOf({ file })) {
        if (targetLayerOf({ specifier, fromFile: file }) !== null) {
          violations.push({
            file: relFile,
            line,
            source: readLine({ file, line }),
            specifier,
          })
        }
      }
    }
  }
  return violations
}

function readLine({ file, line }: { file: string; line: number }): string {
  const text = readFileSync(file, 'utf8').split('\n')[line - 1]
  return text === undefined ? '' : text.trim()
}

function formatViolations({ violations }: { violations: Violation[] }): string {
  return violations
    .map(({ file, line, source }) => `  ${file}:${line}\n    ${source}`)
    .join('\n')
}

describe('api layer architecture', () => {
  const layerViolations = collectLayerViolations()
  const infraViolations = collectInfraViolations()

  it('platform never imports cloud', () => {
    const fresh = layerViolations.filter(
      (violation) => !GRANDFATHERED.has(keyOf(violation)),
    )
    expect(
      fresh,
      `new cross-layer imports are not allowed:\n${formatViolations({ violations: fresh })}`,
    ).toEqual([])
  })

  it('keeps the grandfathered edge list in sync with the code', () => {
    const seen = new Set(layerViolations.map(keyOf))
    const stale = [...GRANDFATHERED].filter((entry) => !seen.has(entry))
    expect(
      stale,
      'these edges no longer exist; remove them from GRANDFATHERED',
    ).toEqual([])
  })

  it('shared infrastructure (_core, _lib, _module, db) never imports a layer', () => {
    expect(
      infraViolations,
      `infrastructure must stay below the layers:\n${formatViolations({ violations: infraViolations })}`,
    ).toEqual([])
  })
})
