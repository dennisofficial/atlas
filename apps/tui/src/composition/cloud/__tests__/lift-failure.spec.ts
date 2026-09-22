import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId } from '@dltech/atlas-core'
import { CloudError, GitCredentialError, VercelNotConfiguredError } from '@dltech/atlas-harness'

import { fakeAgentSnapshot } from '../../__tests__/fake-agents'
import { fakeThreadStore } from '../../__tests__/fake-backend'
import { ELiftFault, ELiftStep, liftToCloud } from '../lift'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { CHILD, fakeLiftAgents, harness } from './lift-fixture'

describe('a lift that does not finish', () => {
  it('leaves the conversation local when the transfer fails, having already stopped what was running', async () => {
    const threads = fakeThreadStore()
    const bridge = fakeBridge({ threadStore: threads })
    bridge.stores.threads.createWithFirstEvents = async () => {
      throw new CloudError({ status: 500, message: 'the sessions API fell over' })
    }
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Transfer)
    expect(lifted.step).toBe(ELiftStep.Transferring)
    expect(lifted.stopped).toEqual({ shells: ['bun run dev'], services: ['api'] })
    expect(test.stops).toBe(1)
    expect(test.located).toEqual([])
    expect(test.bridge.attached).toEqual([])
  })

  it('puts the conversation back on the host when the sandbox will not start', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity in iad1' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Sandbox)
    expect(test.located).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])
    expect(test.localThreads.chosenLocations.at(-1)).toEqual({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Host,
    })
    expect(test.bridge.attached).toEqual([])
  })

  it('puts the conversation back on the host when the context archive will not reach the sandbox', async () => {
    const bridge = fakeBridge({
      putContextFails: new CloudError({ status: 500, message: 'the control plane fell over' }),
    })
    const test = harness({ bridge, captureContext: async () => Buffer.from('a fake tar.gz') })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Context)
    expect(lifted.step).toBe(ELiftStep.UploadingContext)
    expect(lifted.detail).toContain('the control plane fell over')
    expect(test.located).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])
    expect(test.bridge.attached).toEqual([])
  })

  it('reads a 503 from the sandbox routes as the cloud not being set up', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 503, message: 'sandboxes are not configured' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.NotConfigured)
    expect(lifted.detail).toContain('not configured')
  })

  it('reads a missing Vercel token as the cloud sandboxes not being set up, with the teaching intact', async () => {
    const bridge = fakeBridge({
      createFails: new VercelNotConfiguredError('add your Vercel token'),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.NotConfigured)
    expect(lifted.detail).toContain('add your Vercel token')
    expect(lifted.detail).toContain('cloud sandboxes')
  })

  it('reads a gh failure as git access missing, teaching the login', async () => {
    const bridge = fakeBridge({
      createFails: new GitCredentialError('run `gh auth login`, then try again'),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.GitAuth)
    expect(lifted.step).toBe(ELiftStep.Starting)
    expect(lifted.detail).toContain('gh auth login')
    expect(test.located).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])
  })

  it('keeps the real message of a 503 that is not the not-configured one', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({
        status: 503,
        message: 'this deployment has no atlas serve binary at /app/atlas-serve',
      }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Sandbox)
    expect(lifted.detail).toContain('no atlas serve binary')
  })

  it('reads an unreachable API as unreachable rather than as a refusal', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 0, message: 'connect ECONNREFUSED' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)

    expect(lifted.ok).toBe(false)
    if (lifted.ok) return

    expect(lifted.fault).toBe(ELiftFault.Unreachable)
  })

  it('names what the move already closed when it fails after stopping them', async () => {
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity' }),
    })
    const test = harness({ bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.stopped).toEqual({ shells: ['bun run dev'], services: ['api'] })
  })

  it('puts the children back on the host and resumes them when the sandbox will not start', async () => {
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity in iad1' }),
    })
    const test = harness({ agents, bridge })
    await test.localLog.append({
      threadId: CHILD,
      runId: toRunId('run_child'),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
    })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(agents.relocatedTo).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Host])
    expect(agents.resumed).toEqual([CHILD])

    const remote = await test.bridge.threads.find({ threadId: CHILD })
    expect(remote?.executionLocation).toBe(EExecutionLocation.Host)
  })

  it('resumes the children it stopped when the transfer itself fails, before anything flipped', async () => {
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const bridge = fakeBridge()
    bridge.stores.threads.createWithFirstEvents = async () => {
      throw new CloudError({ status: 500, message: 'the sessions API fell over' })
    }
    const test = harness({ agents, bridge })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.step).toBe(ELiftStep.Transferring)
    expect(agents.relocatedTo).toEqual([])
    expect(agents.resumed).toEqual([CHILD])
  })

  it('gives up on a turn that will not stop instead of hanging the move', async () => {
    const test = harness({
      midTurn: true,
      interruptDeadlineMs: 20,
      whenSettled: () => new Promise<void>(() => undefined),
    })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.step).toBe(ELiftStep.Interrupting)
    expect(lifted.detail).toContain('would not stop')
    expect(test.stops).toBe(0)
    expect(test.located).toEqual([])
  })

  it('waits for the session to go quiet even when no turn is in flight', async () => {
    let release = (): void => undefined
    const test = harness({
      midTurn: false,
      whenSettled: () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    })

    const lifting = liftToCloud(test.args)
    await Bun.sleep(10)
    expect(test.stops).toBe(0)
    expect(test.steps).toEqual([])

    release()
    const lifted = await lifting
    expect(lifted.ok).toBe(true)
    expect(test.interrupts).toBe(0)
  })

  it('says what stopLocal closed when stopping the children is what fails', async () => {
    const agents = fakeLiftAgents()
    agents.stopChildren = async () => {
      throw new Error('the registry fell over')
    }
    const test = harness({ agents })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(lifted.step).toBe(ELiftStep.Stopping)
    expect(lifted.stopped).toEqual({ shells: ['bun run dev'], services: ['api'] })
    expect(test.located).toEqual([])
  })

  it('puts the family back into docker when a lift from docker fails', async () => {
    const child = fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })
    const agents = fakeLiftAgents([child])
    const bridge = fakeBridge({
      createFails: new CloudError({ status: 500, message: 'no capacity in iad1' }),
    })
    const test = harness({ agents, bridge })
    await test.localThreads.chooseExecutionLocation({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Docker,
    })
    await test.localLog.append({
      threadId: CHILD,
      runId: toRunId('run_child'),
      drafts: [{ type: 'user-said', text: 'go explore the repo' }],
    })

    const lifted = await liftToCloud(test.args)
    if (lifted.ok) throw new Error('expected the lift to fail')

    expect(test.located).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Docker])
    expect(test.localThreads.chosenLocations.at(-1)).toEqual({
      threadId: CLOUD_THREAD,
      location: EExecutionLocation.Docker,
    })
    expect(agents.relocatedTo).toEqual([EExecutionLocation.Cloud, EExecutionLocation.Docker])
    expect(agents.resumed).toEqual([CHILD])

    const remote = await test.bridge.threads.find({ threadId: CLOUD_THREAD })
    expect(remote?.executionLocation).toBe(EExecutionLocation.Docker)
  })
})
