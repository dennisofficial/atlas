import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { bashDescription } from '../bash-prose'
import { expandPathEnvironment, pathEnvironmentNote } from '../file-text'
import { pathEnvironmentOf, sessionPathsOf } from '../../runtime/session-paths'

const repoRoot = join(import.meta.dir, '../../../../..')
const v1Builtin = join(repoRoot, 'packages/harness/src/tools/builtin')
const v2Directories = [
  join(repoRoot, 'apps/agent-host/src/agent-tools'),
  ...['crew', 'github', 'mcp', 'memory', 'services', 'sessions', 'shells', 'skills', 'web'].map(
    (name) => join(repoRoot, 'plugins', name, 'src', 'pod'),
  ),
]
const constantDirectories = [
  join(repoRoot, 'packages/harness/src'),
  join(repoRoot, 'packages/core/src'),
]

const TOOL_CLASS = /extends (?:SchemaTool|ToolDefinition)</
const QUOTED_NAMES = /readonly name = '([^']+)'/g
const CONSTANT_NAME = /readonly name = ([A-Z][A-Z0-9_]*)/
const CONSTANT_DECLARATION = /export const ([A-Z][A-Z0-9_]*) = '([^']+)'/g
const SESSION_VARIABLE = /^ATLAS_(?:SESSION|CONTEXT|THREAD)_DIR$/

export const EXCEPTIONS: Readonly<Record<string, string>> = {
  artifact_list: 'artifacts are the v2 control plane’s, listed over its API, so a pod has no tool',
  artifact_publish:
    'artifacts are the v2 control plane’s, published over its API, so a pod has no tool',
  artifact_pull: 'artifacts are the v2 control plane’s, fetched over its API, so a pod has no tool',
  artifact_unpublish:
    'artifacts are the v2 control plane’s, unpublished over its API, so a pod has no tool',
  cloud_config: 'cloud config is control-plane state in v2, which agent-host only reads',
  execution_location:
    'a v2 pod never moves execution location; the control plane decides where a session runs',
  'mcp-edit': 'the v2 pod edits its own MCP config, but the operator’s list is the control plane’s',
  operator_input:
    'the v2 cloud loop has no live operator surface mid-tool, so there is nobody to ask',
  operator_shell_input:
    'the v2 cloud loop has no live operator surface mid-tool, so there is nobody to ask',
  routine_create:
    'routines are the v2 control plane’s, scheduled over its API, so a pod has no tool',
  routine_delete:
    'routines are the v2 control plane’s, scheduled over its API, so a pod has no tool',
  routine_list: 'routines are the v2 control plane’s, listed over its API, so a pod has no tool',
  routine_run: 'routines are the v2 control plane’s, run over its API, so a pod has no tool',
  routine_update:
    'routines are the v2 control plane’s, scheduled over its API, so a pod has no tool',
  subscription_list: 'v2 ships the same capability under the github plugin’s list_subscriptions',
}

type Source = { file: string; source: string }

const sourceFilesOf = (directory: string): string[] =>
  readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map((entry) => join(directory, entry))
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.spec.ts'))
    .filter((path) => !path.includes('__tests__'))

const sourcesOf = (directory: string): Source[] =>
  sourceFilesOf(directory).map((file) => ({ file, source: readFileSync(file, 'utf8') }))

const toolSourcesOf = (directory: string): Source[] =>
  sourcesOf(directory).filter((entry) => TOOL_CLASS.test(entry.source))

const constantNamesIn = (sources: readonly Source[]): string[] =>
  sources.flatMap(({ source }) => {
    const match = CONSTANT_NAME.exec(source)
    return match?.[1] === undefined ? [] : [match[1]]
  })

const constantValuesOf = (names: readonly string[]): Map<string, string> => {
  const wanted = new Set(names)
  const values = new Map<string, string>()
  for (const file of constantDirectories.flatMap(sourceFilesOf)) {
    if (values.size === wanted.size) break
    for (const match of readFileSync(file, 'utf8').matchAll(CONSTANT_DECLARATION)) {
      const name = match[1]
      const value = match[2]
      if (name === undefined || value === undefined || !wanted.has(name)) continue
      values.set(name, value)
    }
  }
  return values
}

const namesOf = (source: string, constants: ReadonlyMap<string, string>): string[] => {
  const quoted = [...source.matchAll(QUOTED_NAMES)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )
  if (quoted.length > 0) return quoted
  const constant = CONSTANT_NAME.exec(source)
  if (constant?.[1] === undefined) return []
  const resolved = constants.get(constant[1])
  return resolved === undefined ? [] : [resolved]
}

const v1Sources = toolSourcesOf(v1Builtin)
const v2Sources = v2Directories.flatMap(toolSourcesOf)
const constants = constantValuesOf([...constantNamesIn(v1Sources), ...constantNamesIn(v2Sources)])

const namesIn = (sources: readonly Source[]): string[] =>
  sources.flatMap(({ source }) => namesOf(source, constants))

const v1Tools = namesIn(v1Sources)
const v2Tools = new Set(namesIn(v2Sources))

const documentedSessionVariables = (): string[] => {
  const text = ['file-text.ts', 'bash.ts', 'bash-prose.ts']
    .map((file) => readFileSync(join(v1Builtin, file), 'utf8'))
    .join('\n')
  return [...new Set(text.match(/ATLAS_[A-Z_]+/g) ?? [])].filter((name) =>
    SESSION_VARIABLE.test(name),
  )
}

describe('v1 tools a v2 session has no tool for', () => {
  it('are exactly the ones the exception table names, each with a reason', () => {
    expect(v1Tools.length).toBeGreaterThan(40)

    const missing = v1Tools.filter((name) => !v2Tools.has(name) && EXCEPTIONS[name] === undefined)
    expect(missing).toEqual([])
  })

  it('keeps the exception table honest: no entry v2 registers, none v1 never had, all reasoned', () => {
    const stale = Object.keys(EXCEPTIONS).filter(
      (name) => v2Tools.has(name) || !v1Tools.includes(name),
    )
    expect(stale).toEqual([])
    expect(Object.values(EXCEPTIONS).filter((reason) => reason.trim() === '')).toEqual([])
  })

  it('names every tool module on both sides, so the file rules cannot quietly skip one', () => {
    const unnamed = [...v1Sources, ...v2Sources].filter(
      ({ source }) => namesOf(source, constants).length === 0,
    )
    expect(unnamed.map(({ file }) => file)).toEqual([])
  })
})

describe('the path variable contract both runners share', () => {
  it('expands every session variable the v1 file tools document', () => {
    const paths = sessionPathsOf({ sessionId: 'session-1', threadId: toThreadId('thread-1') })
    const env = pathEnvironmentOf(paths)
    const documented = documentedSessionVariables()

    expect(documented.length).toBeGreaterThan(0)
    for (const name of documented) expect(Object.keys(env)).toContain(name)
    for (const [name, directory] of Object.entries(env)) {
      expect(pathEnvironmentNote).toContain(`$${name}`)
      expect(expandPathEnvironment({ path: `$${name}`, env })).toEqual({
        ok: true,
        path: directory,
      })
    }
  })

  it('names the same session variables in the bash description', () => {
    const description = bashDescription({ defaultTimeoutMs: 120_000, maximumTimeoutMs: 600_000 })

    for (const name of documentedSessionVariables()) expect(description).toContain(name)
  })
})
