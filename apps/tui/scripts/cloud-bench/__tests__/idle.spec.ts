import { expect, it } from 'bun:test'
import { assertIdleSuffix } from '../idle'

it('rejects newly executed historical work even when the captured prefix is unchanged', () => {
  expect(() =>
    assertIdleSuffix({
      threadId: 'clone',
      upTo: 10,
      events: [{ type: 'assistant-said', seq: 11 }],
    }),
  ).toThrow('unexpected benchmark activity')
})
