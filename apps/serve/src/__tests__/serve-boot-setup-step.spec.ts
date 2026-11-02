import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import {
  createBootReporter,
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  type BootStepEvent,
} from '@dltech/atlas-wire'

import { EContainerSetupResult, type ContainerSetup } from '../container-setup'
import { EWorkspaceState } from '../materialize-workspace'
import { bootServeFiles } from '../serve-boot'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const boot = async (containerSetup: ContainerSetup | undefined) => {
  const atlasHome = mkdtempSync(join(tmpdir(), 'atlas-boot-setup-step-'))
  homes.push(atlasHome)
  const events: BootStepEvent[] = []
  const reporter = createBootReporter({
    sink: async (batch) => void events.push(...batch),
  })
  await bootServeFiles({
    env: {},
    threadId: toThreadId('thread-setup-step'),
    cwd: atlasHome,
    atlasHome,
    log: () => undefined,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    controlPlaneUrl: 'https://api.example.com',
    token: 't',
    clientVersion: 'dev',
    fetchFn: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch,
    reporter,
    notice: { notify: () => undefined },
    containerSetup,
  })
  await reporter.flush()
  return events.filter((event) => event.step === EBootStep.Setup)
}

describe('serve boot setup step', () => {
  it('ends Done with setup-script-failed when the script fails', async () => {
    const events = await boot(async () => EContainerSetupResult.Failed)

    expect(events.map((event) => event.state)).toEqual([
      EBootStepState.Running,
      EBootStepState.Done,
    ])
    expect(events[1]?.outcome).toBe(EBootStepOutcome.SetupScriptFailed)
  })

  it('ends Done, never Error, when container setup rejects', async () => {
    const events = await boot(async () => {
      throw new Error('boom')
    })

    expect(events.some((event) => event.state === EBootStepState.Error)).toBe(false)
    expect(events.at(-1)).toEqual({
      step: EBootStep.Setup,
      state: EBootStepState.Done,
      outcome: EBootStepOutcome.SetupScriptFailed,
    })
  })

  it('maps the other results to their outcomes', async () => {
    const outcomes = async (result: EContainerSetupResult) =>
      (await boot(async () => result)).at(-1)?.outcome
    expect(await outcomes(EContainerSetupResult.None)).toBe(EBootStepOutcome.NoSetupScript)
    expect(await outcomes(EContainerSetupResult.Skipped)).toBe(EBootStepOutcome.SetupScriptSkipped)
    expect(await outcomes(EContainerSetupResult.Ran)).toBeUndefined()
  })
})
