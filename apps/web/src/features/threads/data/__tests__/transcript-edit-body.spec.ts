import { describe, expect, it } from 'bun:test'

import { ECallState, type ToolCall } from '@dltech/atlas-client/transcript'
import { toCallId } from '@dltech/atlas-core'
import { EToolState } from '@dltech/atlas-ui/ai/tool'

import { EEditBody, editBodyOf } from '../transcript-edit-body'
import { toolCallItemOf } from '../transcript-tools'

const PATCH = [
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,13 +1,13 @@',
  ' a',
  ' b',
  ' c',
  ' one',
  ' two',
  ' three',
  ' four',
  ' five',
  ' six',
  '-seven',
  '+SEVEN',
  ' eight',
  ' nine',
  ' ten',
  '',
].join('\n')

const callOf = (args: {
  name: string
  input: unknown
  output?: unknown
  state?: ECallState
}): ToolCall => ({
  callId: toCallId('c1'),
  name: args.name,
  input: args.input,
  output: args.output ?? null,
  modelText: '',
  state: args.state ?? ECallState.Ok,
  note: null,
  at: null,
  settledAt: null,
  attachments: [],
})

const numbered = (count: number) => Array.from({ length: count }, (_, i) => `l${i + 1}`).join('\n')

describe('editBodyOf', () => {
  it('turns a settled diff into collapsed viewer lines', () => {
    const body = editBodyOf({
      call: callOf({
        name: 'edit',
        input: { path: 'a.ts' },
        output: { diff: PATCH },
      }),
      state: EToolState.Done,
    })
    expect(body?.kind).toBe(EEditBody.Diff)
    if (body?.kind !== EEditBody.Diff) return
    expect(body).toMatchObject({ added: 1, removed: 1 })
    expect(body.lines.map((line) => line.kind)).toEqual([
      'context',
      'context',
      'context',
      'gap',
      'context',
      'context',
      'context',
      'remove',
      'add',
      'context',
      'context',
      'context',
    ])
  })

  it('shows the tail of dictated content while running', () => {
    const body = editBodyOf({
      call: callOf({
        name: 'write',
        input: { path: 'a.ts', content: `${numbered(30)}\n` },
        state: ECallState.Pending,
      }),
      state: EToolState.Running,
    })
    expect(body).toMatchObject({
      kind: EEditBody.Content,
      firstLine: 11,
      total: 30,
    })
    if (body?.kind !== EEditBody.Content) return
    expect(body.text.split('\n')).toHaveLength(20)
    expect(body.text.startsWith('l11')).toBe(true)
  })

  it('shows the head of dictated content once done without a diff', () => {
    const body = editBodyOf({
      call: callOf({
        name: 'write',
        input: { path: 'a.ts', content: numbered(30) },
      }),
      state: EToolState.Done,
    })
    expect(body).toMatchObject({
      kind: EEditBody.Content,
      firstLine: 1,
      total: 30,
    })
    if (body?.kind !== EEditBody.Content) return
    expect(body.text.endsWith('l20')).toBe(true)
  })

  it('has no body when nothing was dictated', () => {
    expect(
      editBodyOf({
        call: callOf({ name: 'multi_edit', input: { path: 'a.ts' } }),
        state: EToolState.Done,
      }),
    ).toBeUndefined()
  })
})

describe('toolCallItemOf change', () => {
  it('carries the body on edit calls only', () => {
    const edit = toolCallItemOf(callOf({ name: 'edit', input: { path: 'a.ts', newString: 'x' } }))
    expect(edit.change?.kind).toBe(EEditBody.Content)
    const bash = toolCallItemOf(callOf({ name: 'bash', input: { content: 'x' } }))
    expect(bash.change).toBeUndefined()
  })
})
