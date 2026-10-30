import { describe, expect, it } from 'bun:test'

import { listCommandsParamsSchema, listCommandsReplySchema } from '../index'

describe('the list-commands wire', () => {
  it('accepts empty and reload params', () => {
    expect(listCommandsParamsSchema.parse({})).toEqual({})
    expect(listCommandsParamsSchema.parse({ reload: true })).toEqual({ reload: true })
    expect(listCommandsParamsSchema.safeParse({ reload: 'yes' }).success).toBe(false)
  })

  it('round-trips a reply of skill specs', () => {
    const reply = {
      skills: [
        { name: 'review', summary: 'Review', argumentHint: '[pr]', aliases: ['rv'] },
        { name: 'plain', summary: 'Plain' },
      ],
    }
    expect(listCommandsReplySchema.parse(reply)).toEqual(reply)
  })
})
