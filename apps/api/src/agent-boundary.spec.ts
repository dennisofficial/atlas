import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'

const SRC_ROOT = import.meta.dirname
const AGENT_ROOT = path.join(SRC_ROOT, 'agent')
const AGENT_ENTRY = path.join(AGENT_ROOT, 'index.ts')
const API_DIR = path.join(SRC_ROOT, 'api')
const CALLER_DIRS = ['api', '_core', '_lib', '_module', 'trigger']

// A trigger task bundle must not carry the agent barrel: it drags Nest's runtime packages into the
// deployed task (see src/trigger/trigger-bundle.spec.ts). These graphs, and the api modules only they
// load, therefore import the few agent values they construct their dependencies from out of their own
// modules. An entry whose file stops importing agent internals fails the suite.
const TRIGGER_VALUE_IMPORTS = new Set([
  'api/cloud/sandbox-provisioning/pod-provision-rollback.ts',
  'api/cloud/sandbox-provisioning/pod-provision-run.ts',
  'trigger/pod-power/pod-sleep-graph.ts',
  'trigger/pod-disk/pod-disk-grow-graph.ts',
  'trigger/pod-disk/pod-disk-grow-one-graph.ts',
  'trigger/pod-disk/pod-disk-grow-one-graph.spec.ts',
  'trigger/pod-disk/pod-disk-grow-one.task.ts',
  'trigger/pod-resize/pod-resize-graph.ts',
  'trigger/sandbox-cost/agent37-usage-reconcile.task.ts',
  'trigger/sandbox-provisioning/orphan-sandbox-sweep.task.ts',
])

const SPECIFIER_PATTERN = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g

interface Import {
  file: string
  line: number
  specifier: string
  resolved: string
}

function listTsFiles({ dir }: { dir: string }): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listTsFiles({ dir: full }))
      continue
    }
    if (entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

function exists(file: string): boolean {
  try {
    return readdirSync(path.dirname(file)).includes(path.basename(file))
  } catch {
    return false
  }
}

function resolveLocal({ fromFile, specifier }: { fromFile: string; specifier: string }): string {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [`${base}.ts`, path.join(base, 'index.ts'), base.replace(/\.js$/, '.ts'), base]
  return candidates.find((candidate) => exists(candidate)) ?? base
}

function lineAt({ source, offset }: { source: string; offset: number }): number {
  return source.slice(0, offset).split('\n').length
}

function importsInSource({ file, source }: { file: string; source: string }): Import[] {
  return [...source.matchAll(SPECIFIER_PATTERN)].flatMap((match) => {
    const specifier = match[1]
    if (specifier === undefined || !specifier.startsWith('.')) return []
    return [
      {
        file: path.relative(SRC_ROOT, file),
        line: lineAt({ source, offset: match.index }),
        specifier,
        resolved: resolveLocal({ fromFile: file, specifier }),
      },
    ]
  })
}

function importsIn({ dir }: { dir: string }): Import[] {
  return listTsFiles({ dir }).flatMap((file) =>
    importsInSource({ file, source: readFileSync(file, 'utf8') }),
  )
}

const under = ({ file, dir }: { file: string; dir: string }): boolean =>
  file === dir || file.startsWith(`${dir}${path.sep}`)

const reaching = ({ imports, dir }: { imports: Import[]; dir: string }): Import[] =>
  imports.filter((entry) => under({ file: entry.resolved, dir }))

const agentInternals = (imports: Import[]): Import[] =>
  reaching({ imports, dir: AGENT_ROOT }).filter((entry) => entry.resolved !== AGENT_ENTRY)

const notTriggerValueImport = (entry: Import): boolean => !TRIGGER_VALUE_IMPORTS.has(entry.file)

const describeImports = (imports: Import[]): string[] =>
  imports.map((entry) => `${entry.file}:${entry.line} imports ${entry.specifier}`)

const agentCaller = path.join(AGENT_ROOT, 'runtime', 'fixture.ts')
const apiCaller = path.join(API_DIR, 'fixture.ts')

describe('agent boundary', () => {
  it('lets the rest of the api reach the agent only through agent/index.ts', () => {
    const offenders = CALLER_DIRS.flatMap((dir) =>
      describeImports(
        agentInternals(importsIn({ dir: path.join(SRC_ROOT, dir) })).filter(notTriggerValueImport),
      ),
    )

    expect(
      offenders,
      'src/api, src/_core, src/_lib, src/_module and src/trigger may import src/agent only through src/agent/index.ts',
    ).toEqual([])
  })

  it('keeps the trigger value-import list in sync with the code', () => {
    const seen = new Set(
      CALLER_DIRS.flatMap((dir) =>
        agentInternals(importsIn({ dir: path.join(SRC_ROOT, dir) })).map((entry) => entry.file),
      ),
    )
    const stale = [...TRIGGER_VALUE_IMPORTS].filter((file) => !seen.has(file))

    expect(stale, 'these trigger graphs no longer import agent internals; remove them').toEqual([])
  })

  it('keeps the agent independent of api code', () => {
    const offenders = describeImports(
      reaching({ imports: importsIn({ dir: AGENT_ROOT }), dir: API_DIR }),
    )

    expect(
      offenders,
      'src/agent must not import src/api: the agent is a module the root AppModule composes, not a caller of api code',
    ).toEqual([])
  })
})

describe('import scanning', () => {
  it('catches a dynamic import of api code whose specifier sits on the next line', () => {
    const source = [
      'export async function load() {',
      '  const { ApiModule } = await import(',
      "    '../../api/api.module'",
      '  )',
      '  return ApiModule',
      '}',
    ].join('\n')

    const imports = importsInSource({ file: agentCaller, source })

    expect(describeImports(reaching({ imports, dir: API_DIR }))).toEqual([
      `${path.join('agent', 'runtime', 'fixture.ts')}:2 imports ../../api/api.module`,
    ])
  })

  it('catches an api file importing agent internals', () => {
    const source = ["import { AgentModule } from '../agent/agent.module'", ''].join('\n')

    expect(describeImports(agentInternals(importsInSource({ file: apiCaller, source })))).toEqual([
      `${path.join('api', 'fixture.ts')}:1 imports ../agent/agent.module`,
    ])
  })

  it('allows an api file to import the agent entry', () => {
    const source = [
      "import { AgentModule } from '../agent'",
      "import { index as agentEntry } from '../agent/index'",
    ].join('\n')

    const imports = importsInSource({ file: apiCaller, source })

    expect(agentInternals(imports)).toEqual([])
    expect(imports).toHaveLength(2)
  })
})
