import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EExecutionLocation, toThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  EFileLoad,
  ERuntimeKind,
  FileBrowser,
  RemoteMentionFiles,
  rebaseMentionReader,
  type MentionReader,
} from '@dltech/atlas-harness'

import { EDispatch, dispatchSubmission } from '../commands'
import { workspaceFileLoader } from '../mentioned-files'
import { appOf, type Binding } from '../session-binding'
import { fakeApp, scriptedModelPort } from './fake-app'

const roots: string[] = []
const scratch = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-runtime-mentions-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const threadId = toThreadId('runtime-mentions')

describe('runtime-owned composer mentions', () => {
  it('overrides the inherited host browser in the cloud app and attaches remote bytes', async () => {
    const root = await scratch()
    await writeFile(join(root, 'same.txt'), 'host-only contents')
    const local = fakeApp({
      workspaceRoot: root,
      model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
    })
    const requests: EClientRequest[] = []
    const remote = new RemoteMentionFiles({
      threadId,
      channel: {
        request: async ({ op }) => {
          requests.push(op)
          if (op === EClientRequest.MentionFileExists) return { exists: true }
          if (op === EClientRequest.ListMentionFiles)
            return { entries: [{ name: 'cloud-only.txt', isDirectory: false }] }
          return {
            file: {
              type: 'text',
              path: 'same.txt',
              content: 'cloud-only contents',
              truncated: false,
            },
          }
        },
      },
    })
    const binding: Binding = {
      kind: ERuntimeKind.Cloud,
      cwd: '/atlas/workspaces/project',
      adapters: { ...local.sessionOwner.require().adapters, files: remote },
    }
    const app = appOf({ local, binding })
    expect(app.files).toBe(remote)
    expect(await app.files.list('')).toEqual([{ name: 'cloud-only.txt', isDirectory: false }])
    const submission = await dispatchSubmission({
      text: 'read @same.txt',
      commands: [],
      skills: [],
      loadFile: workspaceFileLoader(app.files),
    })
    expect(submission).toMatchObject({
      type: EDispatch.Send,
      drafts: [{ type: 'context-loaded', key: 'same.txt', content: 'cloud-only contents' }],
    })
    expect(requests).toEqual([
      EClientRequest.ListMentionFiles,
      EClientRequest.MentionFileExists,
      EClientRequest.ReadMentionFile,
    ])
    expect(appOf({ local, binding: undefined }).files).toBe(local.files)
  })

  it('never exposes host files while a cloud owner is unbound', async () => {
    const root = await scratch()
    await writeFile(join(root, 'local-only.txt'), 'not cloud context')
    const local = fakeApp({
      workspaceRoot: root,
      model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }),
    })
    await local.executionLocation.activate({ threadId, fallback: EExecutionLocation.Cloud })
    expect(local.sessionOwner.snapshot().binding).toBeUndefined()
    const app = appOf({ local, binding: undefined })
    expect(app.files).not.toBe(local.files)
    expect(appOf({ local, binding: undefined }).files).toBe(app.files)
    await expect(app.files.list('')).rejects.toThrow('the cloud filesystem is still connecting')
    expect(
      await dispatchSubmission({
        text: 'read @local-only.txt',
        commands: [],
        skills: [],
        loadFile: workspaceFileLoader(app.files),
      }),
    ).toMatchObject({ type: EDispatch.Refused })
  })

  it('refuses a failed cloud lookup even when the host has that file', async () => {
    const root = await scratch()
    await writeFile(join(root, 'same.txt'), 'must not reach the model')
    const remote = new RemoteMentionFiles({
      threadId,
      channel: {
        request: async () => {
          throw new Error('the cloud connection failed')
        },
      },
    })
    expect(
      await dispatchSubmission({
        text: 'read @same.txt',
        commands: [],
        skills: [],
        loadFile: workspaceFileLoader(remote),
      }),
    ).toEqual({ type: EDispatch.Refused, reason: 'the cloud connection failed' })
  })

  it('does not depend on highlights resolving before send', async () => {
    const root = await scratch()
    await writeFile(join(root, 'new.txt'), 'fresh content')
    expect(
      await dispatchSubmission({
        text: 'read @new.txt',
        commands: [],
        skills: [],
        loadFile: workspaceFileLoader(new FileBrowser({ root })),
      }),
    ).toMatchObject({
      type: EDispatch.Send,
      drafts: [{ key: 'new.txt', content: 'fresh content' }],
    })
  })

  it('rebases local mentions when the conversation enters a worktree', async () => {
    const launch = await scratch()
    const worktree = await scratch()
    await writeFile(join(launch, 'same.txt'), 'launch')
    await writeFile(join(worktree, 'same.txt'), 'worktree')
    const files = rebaseMentionReader({ reader: new FileBrowser({ root: launch }), root: worktree })
    expect(await files.load('same.txt')).toMatchObject({ type: 'text', content: 'worktree' })
  })

  it('reports a refusal after existence rather than silently sending without the mention', async () => {
    const files: MentionReader = {
      list: async () => [],
      exists: async () => true,
      forget: () => undefined,
      load: async (path: string) => ({ type: EFileLoad.Refused, path, reason: 'it is binary' }),
    }
    expect(
      await dispatchSubmission({
        text: 'read @binary.dat',
        commands: [],
        skills: [],
        loadFile: workspaceFileLoader(files),
      }),
    ).toEqual({ type: EDispatch.Refused, reason: 'Could not attach @binary.dat: it is binary' })
  })
})
