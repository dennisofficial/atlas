import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'bun:test'

import {
  EventLogPort,
  EWebSearchBackend,
  ExecutionLocationSinkPort,
  toCallId,
  toRunId,
  toThreadId,
  type Chunk,
} from '@dltech/atlas-core'

import { ToolDispatcher } from '../../tools/dispatch'
import { ToolRegistry } from '../../tools/registry'
import { JsonlEventLog } from '../../store/sessions/event-log'
import { createHarnessContainer } from '../create-harness-container'
import { registeredPortToken, type DependencyContainer } from '../injection'
import {
  HookChainToken,
  WebSearchBackendToken,
  WorktreeDirectoryToken,
  WorkspaceRoot,
} from '../tokens'

const SESSION_DIRECTORY = '/workspace'

let root = ''

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-graph-'))
})

const rooted = (): DependencyContainer => {
  const container = createHarnessContainer()
  container.register(WorkspaceRoot, { useValue: root })
  container.register(WorktreeDirectoryToken, { useValue: () => '.atlas/worktrees' })
  container.register(WebSearchBackendToken, { useValue: () => EWebSearchBackend.DuckDuckGo })
  return container
}

describe('the harness container graph', () => {
  it('resolves the builtin tools as one registry', () => {
    const names = rooted()
      .resolve(registeredPortToken(ToolRegistry))
      .declarations()
      .map((declaration) => declaration.name)
      .sort()

    expect(names).toEqual([
      'agent_list',
      'agent_say',
      'agent_spawn',
      'agent_stop',
      'bash',
      'edit',
      'enter_worktree',
      'execution_location',
      'exit_worktree',
      'glob',
      'grep',
      'mcp-edit',
      'multi_edit',
      'operator_input',
      'operator_shell_input',
      'read',
      'report_to_main',
      'service_list',
      'service_restart',
      'service_start',
      'service_stop',
      'services_ensure',
      'shell_input',
      'shell_kill',
      'shell_list',
      'shell_output',
      'skill',
      'skill_install',
      'subscribe',
      'subscription_list',
      'task_write',
      'unsubscribe',
      'web_fetch',
      'web_search',
      'worktree_list',
      'write',
    ])
  })

  it('resolves the guard into the before-tool phase and the recorder into after-tool, not phantoms', async () => {
    const hooks = rooted().resolve(HookChainToken)
    const delta: Chunk = { type: 'text-delta', id: 'block-1', text: 'hello' }

    expect(hooks.beforeTool.map((hook) => hook.name)).toEqual([
      'resolveProjectPaths',
      'readBeforeWrite',
      'classifyCall',
      'serviceShape',
    ])
    expect(hooks.afterTool.map((hook) => hook.name)).toEqual([
      'plan',
      'recordFileState',
      'track-worktree',
      'outside-project',
      'invalidateFacts',
    ])
    expect(await hooks.onChunk({ chunk: delta })).toBe(delta)
  })

  it('hands the hook registry out as one instance, however many collaborators ask', () => {
    const container = rooted()

    expect(container.resolve(HookChainToken)).toBe(container.resolve(HookChainToken))
  })

  it('lets a tool call reach outside the root, which no longer walls the filesystem off', async () => {
    const dispatcher = rooted().resolve(registeredPortToken(ToolDispatcher))

    const drafts = await dispatcher.dispatch({
      call: {
        callId: toCallId('call-1'),
        name: 'read',
        input: { path: '/etc/hosts' },
        runId: toRunId('run-1'),
        threadId: toThreadId('thread-1'),
      },
      signal: AbortSignal.timeout(5_000),
      projectDirectory: SESSION_DIRECTORY,
      events: [],
    })

    expect(drafts.map((draft) => draft.type)).toEqual(['tool-result'])
  })

  it('resolves the event log straight from the atlas home, no database to open first', () => {
    expect(rooted().resolve(registeredPortToken(EventLogPort))).toBeInstanceOf(JsonlEventLog)
  })

  it('answers the execution-location sink with a no-op until an app registers a real one', () => {
    const sink = rooted().resolve(registeredPortToken(ExecutionLocationSinkPort))

    expect(() => sink.refresh({ threadId: toThreadId('thread-1') })).not.toThrow()
  })
})
