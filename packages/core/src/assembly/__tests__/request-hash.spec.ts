import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { EToolEffect, type ToolDeclaration } from '../../tools/tool'
import type { Assembled } from '../assembled'
import { requestHashesOf } from '../request-hash'

const tool = (args: { name: string; description: string }): ToolDeclaration => ({
  name: args.name,
  description: args.description,
  effect: EToolEffect.Read,
  inputSchema: z.object({ path: z.string() }),
})

const assembledWith = (system: Assembled['system']): Assembled => ({ system, messages: [] })

describe('requestHashesOf', () => {
  it('gives the same hashes to the same request built twice', () => {
    const build = () =>
      requestHashesOf({
        assembled: assembledWith([{ text: 'prompt', source: 'system-prompt' }]),
        tools: [tool({ name: 'read', description: 'reads' })],
      })
    expect(build()).toEqual(build())
  })

  it('changes only the hash of the system block whose bytes changed, at the same length', () => {
    const tools = [tool({ name: 'read', description: 'reads' })]
    const before = requestHashesOf({
      assembled: assembledWith([
        { text: 'prompt', source: 'system-prompt' },
        { text: '- a\n- b', source: 'memory-index' },
      ]),
      tools,
    })
    const after = requestHashesOf({
      assembled: assembledWith([
        { text: 'prompt', source: 'system-prompt' },
        { text: '- b\n- a', source: 'memory-index' },
      ]),
      tools,
    })
    expect(after['system.memory-index']).not.toBe(before['system.memory-index'])
    expect(after['system.system-prompt']).toBe(before['system.system-prompt'])
    expect(after.tools).toBe(before.tools)
  })

  it('changes the tools hash when the tool order changes', () => {
    const read = tool({ name: 'read', description: 'reads' })
    const write = tool({ name: 'write', description: 'writes' })
    const system = assembledWith([])
    expect(requestHashesOf({ assembled: system, tools: [read, write] }).tools).not.toBe(
      requestHashesOf({ assembled: system, tools: [write, read] }).tools,
    )
  })

  it('hashes the request options so a changed provider option shows', () => {
    const plain = requestHashesOf({ assembled: assembledWith([]), tools: [] })
    const keyed = requestHashesOf({
      assembled: { ...assembledWith([]), requestOptions: { gateway: { sessionId: 't1' } } },
      tools: [],
    })
    expect(keyed.requestOptions).not.toBe(plain.requestOptions)
  })

  it('emits short hex hashes, never the text itself', () => {
    const hashes = requestHashesOf({
      assembled: assembledWith([{ text: 'a secret-looking prompt', source: 'system-prompt' }]),
      tools: [],
    })
    for (const value of Object.values(hashes)) expect(value).toMatch(/^[0-9a-f]{8}$/)
  })
})
