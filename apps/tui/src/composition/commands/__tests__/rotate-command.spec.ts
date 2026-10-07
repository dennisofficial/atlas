import { describe, expect, it } from 'bun:test'

import { dispatchSubmission, EDispatch } from '../dispatch'
import { ECommandTiming } from '../local-command'
import { instructionsOfArgument } from '../rotation'
import { localCommands } from '../registry'
import { handlers } from './local-handlers'

const asked = async (text: string, working = false): Promise<(string | undefined)[]> => {
  const seen: (string | undefined)[] = []
  const commands = localCommands(handlers({ onRotate: (instructions) => seen.push(instructions) }))
  const result = await dispatchSubmission({ text, commands, skills: [], working })
  if (working) expect(result.type).toBe(EDispatch.Queued)
  else expect(result).toEqual({ type: EDispatch.Ran })
  if (result.type === EDispatch.Queued) await result.entry.run()
  return seen
}

describe('the rotate command', () => {
  it('rotates with no instructions when given none', async () => {
    expect(await asked('/rotate')).toEqual([undefined])
  })

  it('treats whitespace after the name as no instructions', async () => {
    expect(await asked('/rotate    ')).toEqual([undefined])
  })

  it('passes the trailing text through verbatim as the instructions', async () => {
    expect(await asked('/rotate keep the auth work, drop the css detour')).toEqual([
      'keep the auth work, drop the css detour',
    ])
  })

  it('waits for the turn to settle, then runs with the same instructions', async () => {
    expect(await asked('/rotate focus on tests', true)).toEqual(['focus on tests'])
    const rotate = localCommands(handlers()).find((one) => one.name === 'rotate')
    expect(rotate?.timing).toBe(ECommandTiming.Settled)
  })

  it('reads blank argument text as undefined', () => {
    expect(instructionsOfArgument('  ')).toBeUndefined()
    expect(instructionsOfArgument(' a b ')).toBe('a b')
  })
})
