import { describe, expect, it } from 'bun:test'

import { ECommandEffect } from '../local-command'
import { dispatchSubmission, EDispatch, type Dispatch } from '../dispatch'
import { localCommands, type LocalCommandHandlers } from '../registry'
import { handlers } from './local-handlers'

const run = async (args: {
  text: string
  working?: boolean
  onChangeDirectory?: LocalCommandHandlers['onChangeDirectory']
}): Promise<Dispatch> =>
  dispatchSubmission({
    text: args.text,
    commands: localCommands(
      handlers(
        args.onChangeDirectory === undefined
          ? {}
          : { onChangeDirectory: args.onChangeDirectory },
      ),
    ),
    skills: [],
    working: args.working ?? false,
  })

describe('the cd command', () => {
  it('hands the argument to the handler and surfaces its notice', async () => {
    const seen: string[] = []
    const dispatched = await run({
      text: '/cd ../other-repo',
      onChangeDirectory: async (argumentText) => {
        seen.push(argumentText)
        return { type: ECommandEffect.Ran, notice: 'this session now works in /work/other-repo' }
      },
    })

    expect(dispatched).toEqual({
      type: EDispatch.Ran,
      notice: 'this session now works in /work/other-repo',
    })
    expect(seen).toEqual(['../other-repo'])
  })

  it('runs a bare /cd as a question about the current directory', async () => {
    const seen: string[] = []
    const dispatched = await run({
      text: '/cd',
      onChangeDirectory: async (argumentText) => {
        seen.push(argumentText)
        return { type: ECommandEffect.Ran, notice: 'this session is working in /work/atlas' }
      },
    })

    expect(dispatched).toEqual({ type: EDispatch.Ran, notice: 'this session is working in /work/atlas' })
    expect(seen).toEqual([''])
  })

  it('reports a refusal as a refusal, not as a move', async () => {
    const dispatched = await run({
      text: '/cd /nope',
      onChangeDirectory: async () => ({
        type: ECommandEffect.Refused,
        reason: 'Atlas cannot work in /nope: no such directory.',
      }),
    })

    expect(dispatched.type).toBe(EDispatch.Refused)
    expect(dispatched.type === EDispatch.Refused && dispatched.reason).toContain('/nope')
  })

  it('waits for the turn to settle before moving', async () => {
    const dispatched = await run({ text: '/cd /tmp', working: true })

    expect(dispatched.type).toBe(EDispatch.Queued)
  })
})
