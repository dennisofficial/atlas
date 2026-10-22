import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'

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
        onContainer:
          args.onContainer ??
          ((asked) => (asked === EContainerAsk.Current ? 'on the host' : `moved to ${asked}`)),
        ...(args.onContainerResources === undefined
          ? {}
          : { onContainerResources: args.onContainerResources }),
      }),
    ),
    skills: [],
  })

describe('the container command', () => {
  it('moves the conversation into a container when asked', async () => {
    const moved: EExecutionLocation[] = []
    const dispatched = await run({
      text: '/container docker',
      onContainer: (asked) => {
        if (asked !== EContainerAsk.Current && asked !== EContainerAsk.Resources) moved.push(asked)
        return 'this conversation now runs in a Docker container'
      },
    })

    expect(dispatched).toEqual({
      type: EDispatch.Ran,
      notice: 'this conversation now runs in a Docker container',
    })
    expect(moved).toEqual([EExecutionLocation.Docker])
  })

  it('moves the conversation back to the host when asked off', async () => {
    const moved: EExecutionLocation[] = []
    const dispatched = await run({
      text: '/container off',
      onContainer: (asked) => {
        if (asked !== EContainerAsk.Current && asked !== EContainerAsk.Resources) moved.push(asked)
        return 'this conversation runs on the host again'
      },
    })

    expect(dispatched.type).toBe(EDispatch.Ran)
    expect(moved).toEqual([EExecutionLocation.Host])
  })

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

  it('reads off and host as the host, however cased or spaced', () => {
    expect(containerAskOfArgument('off')).toBe(EExecutionLocation.Host)
    expect(containerAskOfArgument('  OFF ')).toBe(EExecutionLocation.Host)
    expect(containerAskOfArgument('host')).toBe(EExecutionLocation.Host)
  })

  it('reads docker as the docker container', () => {
    expect(containerAskOfArgument('docker')).toBe(EExecutionLocation.Docker)
    expect(containerAskOfArgument(' Docker ')).toBe(EExecutionLocation.Docker)
  })

  it('reads cloud as the cloud sandbox', () => {
    expect(containerAskOfArgument('cloud')).toBe(EExecutionLocation.Cloud)
    expect(containerAskOfArgument(' Cloud ')).toBe(EExecutionLocation.Cloud)
  })

  it('refuses anything else rather than falling back to a default', () => {
    expect(containerAskOfArgument('podman')).toBe(null)
    expect(containerAskOfArgument('on')).toBe(null)
  })
})
