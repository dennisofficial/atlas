import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { fallbackShellName, withFallbackShellName } from '../fallback-shell-name'

const schema = withFallbackShellName(
  z.strictObject({ description: z.string().min(1), command: z.string().min(1) }),
)

describe('withFallbackShellName', () => {
  it('keeps a name the caller gave', () => {
    expect(schema.parse({ description: 'List files', command: 'ls' })).toEqual({
      description: 'List files',
      command: 'ls',
    })
  })

  it.each([
    ['missing', {}],
    ['null', { description: null }],
    ['blank', { description: '   ' }],
  ])('names a command whose name is %s after the command', (_, name) => {
    expect(schema.parse({ ...name, command: 'cat a.ts;\n  sed -n 1,5p b.ts' })).toEqual({
      description: 'cat a.ts; sed -n 1,5p b.ts',
      command: 'cat a.ts;\n  sed -n 1,5p b.ts',
    })
  })

  it('still refuses input with no command to name it after', () => {
    expect(schema.safeParse({ command: '' }).success).toBe(false)
  })

  it('publishes the name as required, so models are still asked for one', () => {
    expect(z.toJSONSchema(schema).required).toEqual(['description', 'command'])
  })
})

describe('fallbackShellName', () => {
  it('shortens a long command', () => {
    const name = fallbackShellName('x'.repeat(200))

    expect(name).toBe(`${'x'.repeat(80)}…`)
  })
})
