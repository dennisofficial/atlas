import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { composeCommands, defineCommand, type CommandRegistry } from '../registry'
import { EClientAction, ECommandGroup, ECommandRunsIn, type TextArgs } from '../spec'
import { EInvocation, parseInvocation } from '../text'

const rename = defineCommand({
  spec: {
    name: 'rename',
    summary: 'Rename this session',
    group: ECommandGroup.Session,
    args: z.strictObject({ name: z.string().trim().min(1).max(10) }),
    runsIn: ECommandRunsIn.Control,
    fromText: (argumentText: string): TextArgs =>
      argumentText === ''
        ? { ok: false, reason: '/rename needs a name' }
        : { ok: true, args: { name: argumentText } },
  },
})

const help = defineCommand({
  spec: {
    name: 'help',
    summary: 'List the commands',
    group: ECommandGroup.Session,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.CommandList,
  },
})

const rewind = defineCommand({
  spec: {
    name: 'rewind',
    summary: 'Rewind the conversation',
    group: ECommandGroup.Context,
    args: z.strictObject({ toSeq: z.number().int().min(1) }),
    runsIn: ECommandRunsIn.Host,
    fromText: (argumentText: string): TextArgs => ({
      ok: true,
      args: { toSeq: Number(argumentText) },
    }),
  },
})

const commands: CommandRegistry = composeCommands([rename, help, rewind])

const parse = (input: { text: string; skills?: readonly string[] }) =>
  parseInvocation({ text: input.text, commands, skills: input.skills ?? [] })

describe('parseInvocation', () => {
  it('resolves a command at column zero with its arguments', () => {
    const invocation = parse({ text: '/rename bench' })
    expect(invocation).toEqual({
      kind: EInvocation.Command,
      command: rename,
      args: { name: 'bench' },
      argumentText: 'bench',
    })
  })

  it('keeps a leading space, an inner slash and a code span as messages', () => {
    expect(parse({ text: ' /rename bench' })).toEqual({ kind: EInvocation.Message })
    expect(parse({ text: 'see /rename bench' })).toEqual({ kind: EInvocation.Message })
    expect(parse({ text: '`/rename bench`' })).toEqual({ kind: EInvocation.Message })
  })

  it('keeps an unknown name as a message', () => {
    expect(parse({ text: '/usr/bin/env is missing' })).toEqual({ kind: EInvocation.Message })
    expect(parse({ text: '/nope' })).toEqual({ kind: EInvocation.Message })
  })

  it('keeps a name glued to the next word as a message', () => {
    expect(parse({ text: '/rename:bench' })).toEqual({ kind: EInvocation.Message })
  })

  it('resolves a skill with the rest of the line as its argument text', () => {
    expect(parse({ text: '/review src/app.ts', skills: ['review'] })).toEqual({
      kind: EInvocation.Skill,
      name: 'review',
      argumentText: 'src/app.ts',
    })
  })

  it('prefers a command over a skill of the same name', () => {
    const invocation = parse({ text: '/rename bench', skills: ['rename'] })
    expect(invocation.kind).toBe(EInvocation.Command)
  })

  it('returns the sentence of a fromText that refuses', () => {
    expect(parse({ text: '/rename' })).toEqual({
      kind: EInvocation.Refused,
      name: 'rename',
      reason: '/rename needs a name',
    })
  })

  it('refuses argument text for a command that takes none', () => {
    expect(parse({ text: '/help now' })).toEqual({
      kind: EInvocation.Refused,
      name: 'help',
      reason: '/help takes no arguments',
    })
    expect(parse({ text: '/help' })).toEqual({
      kind: EInvocation.Command,
      command: help,
      args: {},
      argumentText: '',
    })
  })

  it('refuses text with a sentence when the arguments fail their schema', () => {
    expect(parse({ text: '/rename a-very-long-name' })).toEqual({
      kind: EInvocation.Refused,
      name: 'rename',
      reason: 'The arguments for /rename are not valid',
    })
    expect(parse({ text: '/rewind two' })).toEqual({
      kind: EInvocation.Refused,
      name: 'rewind',
      reason: 'The arguments for /rewind are not valid',
    })
  })

  it('chains nothing: the rest of the line is all argument text', () => {
    expect(parse({ text: '/rename /help' })).toEqual({
      kind: EInvocation.Command,
      command: rename,
      args: { name: '/help' },
      argumentText: '/help',
    })
  })

  it('takes the argument text from every line after the name', () => {
    const invocation = parse({ text: '/rename\nbench' })
    expect(invocation).toMatchObject({ kind: EInvocation.Command, argumentText: 'bench' })
  })

  it('lets only the first line decide', () => {
    expect(parse({ text: 'hello\n/rename bench' })).toEqual({ kind: EInvocation.Message })
  })
})
