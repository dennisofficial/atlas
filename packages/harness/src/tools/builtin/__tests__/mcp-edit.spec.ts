import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EBeforeToolDecision,
  EToolEffect,
  TAKES_NO_PATHS,
  toCallId,
  toThreadId,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { CloudSessionStore } from '../../../cloud/cloud-session'
import { ResolveProjectPathsHook } from '../../../hooks/resolve-project-paths'
import { McpEditTool } from '../mcp-edit'

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'atlas-mcp-edit-tool-'))
})

const invoke = async (input: unknown): Promise<ToolOutcome> =>
  new McpEditTool().invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'edit-1',
    projectDirectory: root,
    threadId: toThreadId('thread-1'),
  })

describe('McpEditTool', () => {
  it('is a write that declares no path fields, since layer is an enum rather than a path', () => {
    const tool = new McpEditTool()

    expect(tool.name).toBe('mcp-edit')
    expect(tool.effect).toBe(EToolEffect.Write)
    expect(tool.pathFields).toBe(TAKES_NO_PATHS)
  })

  it('accepts the input the dispatcher hands it after resolveProjectPaths ran', async () => {
    const tool = new McpEditTool()
    const input = {
      layer: 'project',
      name: 'linear',
      transport: { kind: 'stdio', command: 'npx' },
      action: 'upsert',
    }

    const hook = await new ResolveProjectPathsHook([tool]).run({
      call: {
        callId: toCallId('call-1'),
        name: tool.name,
        input,
        effect: tool.effect,
        threadId: toThreadId('thread-1'),
      },
      projectDirectory: root,
      events: [],
      signal: new AbortController().signal,
    })

    expect(hook.decision).toBe(EBeforeToolDecision.Allow)
    if (hook.decision !== EBeforeToolDecision.Allow) return
    expect(hook.input).toEqual(input)

    const outcome = await tool.invoke({
      input: hook.input,
      signal: new AbortController().signal,
      idempotencyKey: 'edit-1',
      projectDirectory: root,
      threadId: toThreadId('thread-1'),
    })
    expect(outcome).toMatchObject({ ok: true })
  })

  it('upserts through invoke end to end', async () => {
    const outcome = await invoke({
      layer: 'project',
      name: 'linear',
      transport: { kind: 'stdio', command: 'npx' },
      action: 'upsert',
    })

    expect(outcome).toMatchObject({ ok: true })
    if (outcome.ok) {
      expect(outcome.modelText).toContain('linear')
      expect(outcome.modelText).toContain(join(root, '.atlas', 'mcp.json'))
    }
  })

  it('disables without demanding a transport', async () => {
    const outcome = await invoke({
      layer: 'project',
      name: 'linear',
      action: 'disable',
    })

    expect(outcome).toMatchObject({ ok: true })
  })

  it('enables a stub back over the file', async () => {
    await invoke({ layer: 'project', name: 'linear', action: 'disable' })

    const outcome = await invoke({
      layer: 'project',
      name: 'linear',
      transport: { kind: 'stdio', command: 'run' },
      action: 'enable',
    })

    expect(outcome).toMatchObject({ ok: true })
    const text = JSON.parse(await Bun.file(join(root, '.atlas', 'mcp.json')).text()) as Record<string, unknown>
    expect('disabled' in Object(text['linear'])).toBe(false)
  })

  it('removes, gracefully answering success for a name it never held', async () => {
    const outcome = await invoke({
      layer: 'project',
      name: 'nobody',
      action: 'remove',
    })

    expect(outcome).toMatchObject({ ok: true })
    expect(outcome.ok && outcome.modelText).toContain('removed')
  })

  it('rejects an invalid transport before a byte is written', async () => {
    const outcome = await invoke({
      layer: 'project',
      name: 'badurl',
      transport: { kind: 'http', url: 'no-scheme' },
      action: 'upsert',
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('invalid input')
  })

  it('rejects a name whose charset the loaders would reject', async () => {
    const outcome = await invoke({
      layer: 'project',
      name: 'bad name',
      transport: { kind: 'stdio', command: 'npx' },
      action: 'upsert',
    })

    expect(outcome.ok).toBe(false)
    expect(await Bun.file(join(root, '.atlas', 'mcp.json')).exists()).toBe(false)
  })

  it('writes the user layer where ATLAS_HOME sends it', async () => {
    process.env['ATLAS_HOME'] = root
    try {
      mkdirSync(join(root, '.atlas'))
      writeFileSync(join(root, '.atlas', 'mcp.json'), JSON.stringify({}))

      const outcome = await invoke({
        layer: 'user',
        name: 'home',
        transport: { kind: 'http', url: 'https://example.test/mcp' },
        action: 'upsert',
      })

      expect(outcome).toMatchObject({ ok: true })
      if (outcome.ok) expect(outcome.output).toMatchObject({ path: join(root, 'mcp.json') })
    } finally {
      delete process.env['ATLAS_HOME']
    }
  })

  it('writes the compat file at the project root for project-compat', async () => {
    const outcome = await invoke({
      layer: 'project-compat',
      name: 'legacy',
      transport: { kind: 'stdio', command: 'run' },
      action: 'upsert',
    })

    expect(outcome).toMatchObject({ ok: true })
    if (outcome.ok) expect(outcome.output).toMatchObject({ path: join(root, '.mcp.json') })
  })
})

describe('McpEditTool with a cloud session', () => {
  const realFetch = globalThis.fetch
  const realAtlasHome = process.env['ATLAS_HOME']
  let calls: string[]

  beforeEach(() => {
    process.env['ATLAS_HOME'] = root
    const sessions = new CloudSessionStore({
      file: join(root, 'cloud.json'),
      keyFile: join(root, 'key'),
    })
    sessions.write({ url: 'http://cloud.test', token: 'sess_a', email: 'a@b.c' })
    calls = []
    globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
      calls.push(String(input))
      throw new Error('Atlas Cloud is offline')
    }, { preconnect: realFetch.preconnect })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    if (realAtlasHome === undefined) delete process.env['ATLAS_HOME']
    else process.env['ATLAS_HOME'] = realAtlasHome
  })

  it('writes the local user file while signed in and the API is down', async () => {
    const outcome = await invoke({
      layer: 'user',
      name: 'linear',
      transport: { kind: 'http', url: 'https://mcp.linear.app/mcp' },
      action: 'upsert',
    })

    expect(outcome).toMatchObject({ ok: true })
    expect(calls).toEqual([])
    const content = await Bun.file(join(root, 'mcp.json')).json()
    expect(content).toMatchObject({ linear: { transport: { kind: 'http' } } })
  })

  it('removes locally while signed in without requesting the API', async () => {
    writeFileSync(join(root, 'mcp.json'), JSON.stringify({ linear: { disabled: true } }))

    const outcome = await invoke({ layer: 'user', name: 'linear', action: 'remove' })

    expect(outcome).toMatchObject({ ok: true })
    expect(calls).toEqual([])
    expect(await Bun.file(join(root, 'mcp.json')).json()).toEqual({})
  })
})


