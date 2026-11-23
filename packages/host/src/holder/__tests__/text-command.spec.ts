import { describe, expect, it } from 'bun:test'

import {
  composeCommands,
  defineCommand,
  EClientAction,
  ECommandGroup,
  ECommandRunsIn,
  type Command,
  type CommandHandler,
  type ControlCommandHandler,
  type TextArgs,
} from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'
import { z } from 'zod'

import {
  clientOnlyReason,
  ETextPlan,
  isTextCommand,
  noRunnerReason,
  planTextInput,
  type ControlHandlers,
} from '../text-command'

const wordFromText = (argumentText: string): TextArgs =>
  argumentText === ''
    ? { ok: false, reason: 'needs a word' }
    : { ok: true, args: { word: argumentText } }

const hostCommand = (name: string): Command =>
  defineCommand({
    spec: {
      name,
      summary: 'records a word',
      group: ECommandGroup.Context,
      args: z.strictObject({ word: z.string().min(1) }),
      runsIn: ECommandRunsIn.Host,
      fromText: wordFromText,
    },
  })

const controlCommand = (name: string, fromText: (argumentText: string) => TextArgs): Command =>
  defineCommand({
    spec: {
      name,
      summary: 'changes the session',
      group: ECommandGroup.Session,
      args: z.strictObject({ name: z.string().trim().min(1) }),
      runsIn: ECommandRunsIn.Control,
      fromText,
    },
  })

const model = defineCommand({
  spec: {
    name: 'model',
    summary: 'opens the model picker',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.ModelPicker,
  },
})

const rename = controlCommand('rename', (argumentText) =>
  argumentText === ''
    ? { ok: false, reason: '/rename needs a name' }
    : { ok: true, args: { name: argumentText } },
)

const resize = defineCommand({
  spec: {
    name: 'resize',
    summary: 'resizes the sandbox',
    group: ECommandGroup.Session,
    args: z.strictObject({ vcpus: z.number(), memoryGb: z.number() }),
    runsIn: ECommandRunsIn.Control,
    fromText: (argumentText) => {
      const [vcpus, memoryGb] = argumentText.split(' ').map(Number)
      return { ok: true, args: { vcpus, memoryGb } }
    },
  },
})

const summarise = hostCommand('summarise')

const registry = composeCommands([summarise, rename, resize, model])

const hostHandler: CommandHandler<unknown> = async () => ({ kind: 'done' })
const controlHandler: ControlCommandHandler<ControlPlane, unknown> = async () => undefined

const handlers = new Map([[summarise.inboxKind, hostHandler]])
const controlHandlers: ControlHandlers = new Map([['rename', controlHandler]])

const planOf = (text: string, skills: readonly string[] = []) =>
  planTextInput({ text, commands: registry, handlers, controlHandlers, skills: async () => skills })

describe('planTextInput', () => {
  it('plans a control command with the typed line it consumed', async () => {
    const plan = await planOf('/rename bench')
    expect(plan.kind).toBe(ETextPlan.Command)
    if (plan.kind !== ETextPlan.Command) return
    expect(plan.command.spec.name).toBe('rename')
    expect('control' in plan.run).toBe(true)
    expect(plan.args).toEqual({ name: 'bench' })
    expect(plan.consumed).toEqual({ name: 'rename', argumentText: 'bench', text: '/rename bench' })
  })

  it('refuses a client command with the sentence that sends it to the menu', async () => {
    expect(await planOf('/model')).toEqual({
      kind: ETextPlan.Refused,
      reason: clientOnlyReason('model'),
    })
  })

  it('refuses a command whose surface has no handler in this host', async () => {
    expect(await planOf('/resize 2 4')).toEqual({
      kind: ETextPlan.Refused,
      reason: noRunnerReason('resize'),
    })
  })

  it('leaves an unknown name and an indented slash as a message', async () => {
    expect(await planOf('/nope x')).toEqual({ kind: ETextPlan.Message })
    expect(await planOf(' /rename x')).toEqual({ kind: ETextPlan.Message })
  })

  it('refuses with the command own sentence when the argument is missing', async () => {
    expect(await planOf('/rename')).toEqual({
      kind: ETextPlan.Refused,
      reason: '/rename needs a name',
    })
  })

  it('plans a skill name with its argument text', async () => {
    expect(await planOf('/review src/app.ts', ['review'])).toEqual({
      kind: ETextPlan.Skill,
      name: 'review',
      argumentText: 'src/app.ts',
    })
  })

  it('lets a command name beat a skill name', async () => {
    expect(await planOf('/rename bench', ['rename'])).toMatchObject({
      kind: ETextPlan.Command,
    })
  })

  it('reports whether a plan is anything but a plain message', async () => {
    expect(isTextCommand(await planOf('/rename bench'))).toBe(true)
    expect(isTextCommand(await planOf('hello'))).toBe(false)
  })
})
