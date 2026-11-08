import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { fallbackShellName, withFallbackShellName } from '../fallback-shell-name'

const schema = withFallbackShellName(
  z.strictObject({
    description: z.string().min(1),
    command: z.string().min(1),
    workdir: z.string().min(1).optional(),
  }),
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
    ['not a string', { description: 42 }],
  ])('names a command whose name is %s after the command', (_, name) => {
    expect(schema.parse({ ...name, command: 'cat a.ts;\n  sed -n 1,5p b.ts' })).toEqual({
      description: 'cat a.ts; sed -n 1,5p b.ts',
      command: 'cat a.ts;\n  sed -n 1,5p b.ts',
    })
  })

  it('still refuses input with no command to name it after', () => {
    expect(schema.safeParse({ command: '' }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('publishes the name first and required, so a model writes one before its command', () => {
    const declared = z.toJSONSchema(schema)

    expect(Object.keys(declared.properties ?? {})[0]).toBe('description')
    expect(declared.required).toEqual(['description', 'command'])
  })
})

describe('fallbackShellName', () => {
  it('shortens a long command', () => {
    const name = fallbackShellName('x'.repeat(200))

    expect(name).toBe(`${'x'.repeat(80)}…`)
  })
})
