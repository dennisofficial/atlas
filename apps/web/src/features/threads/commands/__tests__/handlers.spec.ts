import { describe, expect, it } from 'bun:test'

import {
  ECommand,
  ECommandEffect,
  ECommandKind,
  ECommandGroup,
  UNSUPPORTED,
  surfaceCommands,
  type CommandSpec,
} from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-client/channel'

import { dispatchSubmission, EDispatch, SETTLED_WHILE_WORKING } from '../dispatch'
import { NOT_CONNECTED, webCommandHandlers, type CommandDeps } from '../web-command-handlers'

const rig = (
  reply: unknown = {
    type: 'compacted',
    replaced: 4,
    fromSeq: 1,
    throughSeq: 4,
  },
) => {
  const calls: { op: EClientRequest; params: unknown }[] = []
  const navigated: string[] = []
  const deps: CommandDeps = {
    threadId: 'thr_1',
    request: (call) => {
      calls.push(call)
      return Promise.resolve(reply)
    },
    operationId: () => 'op_1',
    openModelPicker: () => undefined,
    openSearch: () => undefined,
    openDetails: () => undefined,
    navigate: (href) => void navigated.push(href),
    wake: async () => undefined,
    reloadSkills: async () => 3,
  }
  const handlers = webCommandHandlers(deps)
  const commands = surfaceCommands({ handlers })
  const run = (text: string, working = false, skills: readonly CommandSpec[] = []) =>
    dispatchSubmission({ text, handlers, commands, skills, working })
  return { calls, navigated, run, handlers, deps }
}

const skill: CommandSpec = {
  name: 'review',
  kind: ECommandKind.Skill,
  summary: 'review',
  group: ECommandGroup.Workspace,
}

describe('web dispatch', () => {
  it('maps /compact all to the everything scope', async () => {
    const test = rig()
    expect((await test.run('/compact all')).type).toBe(EDispatch.Ran)
    expect(test.calls[0]).toEqual({
      op: EClientRequest.CompactHistory,
      params: { threadId: 'thr_1', operationId: 'op_1', scope: 'everything' },
    })
  })

  it('refuses a bad compact argument without calling the sandbox', async () => {
    const test = rig()
    expect((await test.run('/compact nope')).type).toBe(EDispatch.Refused)
    expect(test.calls).toHaveLength(0)
  })

  it('refuses an empty rename and sends a named one', async () => {
    const test = rig()
    expect((await test.run('/rename')).type).toBe(EDispatch.Refused)
    expect((await test.run('/rename Big idea')).type).toBe(EDispatch.Ran)
    expect(test.calls[0]?.op).toBe(EClientRequest.RenameThread)
  })

  it('renames through the host without a connected channel or wake', async () => {
    const test = rig()
    const renamed: { threadId: string; title: string }[] = []
    const handlers = webCommandHandlers({
      ...test.deps,
      request: () => null,
      rename: async (args) => {
        renamed.push(args)
      },
      wake: async () => {
        throw new Error('rename must not wake')
      },
    })
    const result = await dispatchSubmission({
      text: '/rename  Local title  ',
      handlers,
      commands: surfaceCommands({ handlers }),
      skills: [],
      working: false,
    })
    expect(result.type).toBe(EDispatch.Ran)
    expect(renamed).toEqual([{ threadId: 'thr_1', title: 'Local title' }])
    expect(test.calls).toEqual([])
  })

  it('refuses unsupported commands', async () => {
    const test = rig()
    expect(await test.run('/cd /tmp')).toEqual({
      type: EDispatch.Refused,
      reason: "/cd isn't available in the browser",
    })
    expect(test.handlers[ECommand.Rewind]).toBe(UNSUPPORTED)
  })

  it('refuses settled commands while working', async () => {
    const test = rig()
    expect(await test.run('/compact', true)).toEqual({
      type: EDispatch.Refused,
      reason: SETTLED_WHILE_WORKING,
    })
    expect((await test.run('/model', true)).type).toBe(EDispatch.Ran)
  })

  it('navigates for /new and the /clear alias', async () => {
    const test = rig()
    await test.run('/new')
    await test.run('/clear')
    expect(test.navigated).toEqual(['/threads/new', '/threads/new'])
  })

  it('sends skill mentions and prose as text', async () => {
    const test = rig()
    expect((await test.run('/review this', false, [skill])).type).toBe(EDispatch.Send)
    expect((await test.run('hello there')).type).toBe(EDispatch.Send)
  })

  it('refuses a skill named like an unsupported command', async () => {
    const test = rig()
    const exit: CommandSpec = { ...skill, name: 'exit' }
    expect((await test.run('/exit now', false, [exit])).type).toBe(EDispatch.Send)
    expect((await test.run('/exit now')).type).toBe(EDispatch.Refused)
  })

  it('reports skill counts', async () => {
    const test = rig()
    const skillsRun = (reloadSkills: () => Promise<number>) =>
      surfaceCommands({
        handlers: webCommandHandlers({ ...test.deps, reloadSkills }),
      })
        .find((c) => c.name === 'skills')
        ?.run({ argumentText: '' })
    expect(await skillsRun(async () => 1)).toEqual({
      type: ECommandEffect.Ran,
      notice: '1 skill',
    })
    expect(await skillsRun(async () => 3)).toEqual({
      type: ECommandEffect.Ran,
      notice: '3 skills',
    })
  })

  it('refuses requests when disconnected', async () => {
    const test = rig()
    const handlers = webCommandHandlers({ ...test.deps, request: () => null })
    const effect = await (
      surfaceCommands({ handlers }).find((c) => c.name === 'compact')?.run ??
      (() => {
        throw new Error('missing')
      })
    )({ argumentText: '' })
    expect(effect).toEqual({
      type: ECommandEffect.Refused,
      reason: NOT_CONNECTED,
    })
  })
})
