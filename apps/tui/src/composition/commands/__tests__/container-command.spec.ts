import { describe, expect, it } from 'bun:test'

import { dispatchSubmission, EDispatch, type Dispatch } from '../dispatch'
import {
  containerAskOfArgument,
  EContainerAsk,
  localCommands,
  type LocalCommandHandlers,
} from '../registry'
import { handlers } from './local-handlers'

const run = async (args: {
  text: string
  onContainer?: LocalCommandHandlers['onContainer']
  onContainerResources?: LocalCommandHandlers['onContainerResources']
}): Promise<Dispatch> =>
  dispatchSubmission({
    text: args.text,
    commands: localCommands(
      handlers({
        onContainer: args.onContainer ?? (() => 'on the host'),
        ...(args.onContainerResources === undefined
          ? {}
          : { onContainerResources: args.onContainerResources }),
      }),
    ),
    skills: [],
  })

describe('the container command', () => {
  it('answers where the conversation runs without moving anything', async () => {
    const dispatched = await run({ text: '/container' })

    expect(dispatched).toEqual({ type: EDispatch.Ran, notice: 'on the host' })
  })

  it('says what it takes rather than guessing at a runtime it does not know', async () => {
    const dispatched = await run({ text: '/container podman' })

    expect(dispatched.type).toBe(EDispatch.Refused)
    expect(dispatched.type === EDispatch.Refused && dispatched.reason).toContain('podman')
  })

  it('hands resources to its own handler rather than to a move', async () => {
    let opened = 0
    const dispatched = await run({
      text: '/container resources',
      onContainer: () => {
        throw new Error('a resize is not a move')
      },
      onContainerResources: () => {
        opened += 1
        return 'opening the resize overlay'
      },
    })

    expect(dispatched).toEqual({ type: EDispatch.Ran, notice: 'opening the resize overlay' })
    expect(opened).toBe(1)
  })

  it('runs resources silently when the overlay owns the answer', async () => {
    const dispatched = await run({
      text: '/container resources',
      onContainerResources: () => undefined,
    })

    expect(dispatched).toEqual({ type: EDispatch.Ran, notice: undefined })
  })
})

describe('what /container was asked for', () => {
  it('reads a bare invocation as a question about the current location', () => {
    expect(containerAskOfArgument('')).toBe(EContainerAsk.Current)
    expect(containerAskOfArgument('   ')).toBe(EContainerAsk.Current)
  })

  it('reads resources however cased or spaced', () => {
    expect(containerAskOfArgument(' Resources ')).toBe(EContainerAsk.Resources)
  })

  it('refuses the old move targets rather than falling back to a default', () => {
    expect(containerAskOfArgument('docker')).toBe(null)
    expect(containerAskOfArgument('off')).toBe(null)
    expect(containerAskOfArgument('cloud')).toBe(null)
  })
})
