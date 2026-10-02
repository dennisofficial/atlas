import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAgentStart,
  EAgentStatus,
  EExecutionLocation,
  toCallId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { activateTransferredChildren, adoptTransferredChildren } from '../../../cloud/relocation/adopt-transferred-children'
import { AgentSupervisor } from '../supervisor'
import { finished, type OpenedSupervisor } from './fixtures'
import { append, endingFor, openChild, openFamily, snapshotOf } from './transferred-fixture'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const midTool: readonly EventDraft[] = [
  { type: 'tool-called', callId: toCallId('call_read'), name: 'read_file', ordinal: 0 },
]

const MAIN = '/home/main'
const WORKTREE = '/home/main/.atlas/worktrees/feature-a'
const SUBDIRECTORY = '/home/main/packages/feature-b'
const WORKSPACE = '/home/main/packages/feature-c'

const arrivedAtMain: EventDraft = {
  type: 'location-changed',
  from: EExecutionLocation.Cloud,
  to: EExecutionLocation.Host,
  cwd: MAIN,
}

const directoriesOfStarted = (entry: OpenedSupervisor): Map<ThreadId, string | undefined> =>
  new Map(entry.runners.started.map((run) => [run.threadId, run.request.projectDirectory]))

describe('the directory a transferred child resumes in', () => {
  it('is the one its own landed log says per child, and the owner directory when the log says none', async () => {
    const entry = await openFamily(opened)
    await append(entry, entry.parent, [arrivedAtMain])
    const inWorktree = await openChild({ entry, spawnedBy: entry.parent })
    const inSubdirectory = await openChild({ entry, spawnedBy: entry.parent })
    const untouched = await openChild({ entry, spawnedBy: entry.parent })
    await append(entry, inWorktree, [
      { type: 'worktree-entered', path: WORKTREE, branch: 'feature-a' },
      ...midTool,
    ])
    await append(entry, inSubdirectory, [{ type: 'directory-changed', path: SUBDIRECTORY }, ...midTool])
    await append(entry, untouched, midTool)
    await entry.supervisor.hydrate({ threadId: entry.parent })

    await adoptTransferredChildren({ agents: entry.supervisor, threadId: entry.parent })
    const resumed = await activateTransferredChildren({
      agents: entry.supervisor,
      log: entry.harness.log,
      threadId: entry.parent,
    })

    expect(resumed).toHaveLength(3)
    const directories = directoriesOfStarted(entry)
    expect(directories.get(inWorktree)).toBe(WORKTREE)
    expect(directories.get(inSubdirectory)).toBe(SUBDIRECTORY)
    expect(directories.get(untouched)).toBe(MAIN)
  })

  it('replaces the directory a child had resolved before the family arrived', async () => {
    const entry = await openFamily(opened)
    const child = await openChild({ entry, spawnedBy: entry.parent })
    await append(entry, child, [{ type: 'directory-changed', path: '/elsewhere/old' }, ...midTool])
    await entry.supervisor.hydrate({ threadId: entry.parent })
    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })
    await append(entry, child, [{ type: 'directory-changed', path: SUBDIRECTORY }])

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })
    await entry.supervisor.resume({ agentId: child, threadId: entry.parent })

    expect(directoriesOfStarted(entry).get(child)).toBe(SUBDIRECTORY)
  })

  it('falls back to the workspace the child thread was restored with when its log names none', async () => {
    const entry = await openFamily(opened)
    const { id } = await entry.harness.threads.create({
      workspace: WORKSPACE,
      agent: { spawnedBy: entry.parent, type: 'explore' },
    })
    await append(entry, entry.parent, [
      { type: 'agent-spawned', agentId: id, agentType: 'explore', intent: 'a look', mode: EAgentStart.Fresh },
    ])
    await append(entry, id, midTool)

    await adoptTransferredChildren({ agents: entry.supervisor, threadId: entry.parent })
    await entry.supervisor.resume({ agentId: id, threadId: entry.parent })

    expect(directoriesOfStarted(entry).get(id)).toBe(WORKSPACE)
  })

  it('is inherited by a nested child from its owner when its own thread says nothing', async () => {
    const entry = await openFamily(opened)
    const owner = await openChild({ entry, spawnedBy: entry.parent, agentType: 'teammate' })
    const nested = await openChild({ entry, spawnedBy: owner })
    await append(entry, owner, [{ type: 'directory-changed', path: SUBDIRECTORY }])
    await append(entry, nested, midTool)

    await adoptTransferredChildren({ agents: entry.supervisor, threadId: entry.parent })
    await entry.supervisor.resume({ agentId: nested, threadId: owner })

    expect(snapshotOf(entry, owner, nested)?.status).toBe(EAgentStatus.Running)
    expect(directoriesOfStarted(entry).get(nested)).toBe(SUBDIRECTORY)
  })
})

describe('the model of a transferred child', () => {
  it('follows the landed thread when it names another model', async () => {
    const entry = await openFamily(opened)
    const child = await openChild({ entry, spawnedBy: entry.parent })
    await entry.harness.threads.chooseModel({
      threadId: child,
      model: { ref: 'anthropic/claude-opus-5', effort: 'medium' },
    })
    await entry.supervisor.hydrate({ threadId: entry.parent })
    await entry.harness.threads.chooseModel({
      threadId: child,
      model: { ref: 'openai/gpt-5-codex', effort: 'medium' },
      retarget: true,
    })

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(snapshotOf(entry, entry.parent, child)?.model).toEqual({
      id: 'openai',
      modelId: 'gpt-5-codex',
    })
  })

  it('is cleared when the landed thread records none, rather than keeping the stale one', async () => {
    const entry = await openFamily(opened)
    const child = await openChild({ entry, spawnedBy: entry.parent })
    await entry.harness.threads.chooseModel({
      threadId: child,
      model: { ref: 'anthropic/claude-opus-5', effort: 'medium' },
    })
    let landedWithoutModel = false
    const threads = Object.create(entry.harness.threads, {
      find: {
        value: async (args: { threadId: ThreadId }) => {
          const found = await entry.harness.threads.find(args)
          return found === undefined || !landedWithoutModel ? found : { ...found, model: undefined }
        },
      },
    })
    const supervisor = new AgentSupervisor({
      log: entry.harness.log,
      threads,
      ids: entry.harness.ids,
      clock: entry.harness.clock,
      agentTypes: entry.supervisor.types(),
      runners: entry.runners.source,
      launchDirectory: '/launch',
    })
    await supervisor.hydrate({ threadId: entry.parent })
    expect(supervisor.list({ threadId: entry.parent })[0]?.model).toBeDefined()
    landedWithoutModel = true

    await supervisor.hydrateTransferred({ threadId: entry.parent })

    expect(supervisor.list({ threadId: entry.parent })[0]?.model).toBeUndefined()
  })
})

describe('a local child the incoming family no longer names', () => {
  it('detaches from the roster and its notices, while another thread keeps its own', async () => {
    const entry = await openFamily(opened)
    const other = (await entry.harness.threads.create({})).id
    const spawn = async (threadId: ThreadId) => {
      const outcome = await entry.supervisor.spawn({
        threadId,
        agentType: 'explore',
        brief: 'look',
        intent: 'a look',
      })
      if (!outcome.ok) throw new Error(outcome.reason)
      return outcome.snapshot.agentId
    }
    const stale = await spawn(entry.parent)
    const unrelated = await spawn(other)
    const running = await spawn(entry.parent)
    entry.runners.started.find((run) => run.threadId === stale)?.settle(finished())
    entry.runners.started.find((run) => run.threadId === unrelated)?.settle(finished())
    await new Promise((resolve) => setTimeout(resolve, 0))
    await entry.harness.log.replace({
      threadId: entry.parent,
      runId: entry.harness.ids.nextRunId(),
      drafts: [
        { type: 'agent-spawned', agentId: running, agentType: 'explore', intent: 'a look', mode: EAgentStart.Fresh },
        endingFor({ agentId: running, status: EAgentStatus.Finished }),
      ],
    })

    await entry.supervisor.hydrateTransferred({ threadId: entry.parent })

    const ids = entry.supervisor.list({ threadId: entry.parent }).map((one) => one.agentId)
    expect(ids).toEqual([running])
    expect(entry.supervisor.pendingNotices({ threadId: entry.parent })).toHaveLength(0)
    expect(snapshotOf(entry, other, unrelated)?.status).toBe(EAgentStatus.Finished)
    expect(entry.supervisor.pendingNotices({ threadId: other })).toHaveLength(1)
  })
})
