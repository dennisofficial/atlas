import { afterEach, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'

import { EExecutionLocation, ERunner, toThreadId } from '@dltech/atlas-core'

import { PlacementController } from '../../composition/placement-controller'
import { createSessionOwner, ERuntimeKind, type SessionRuntime } from '../../composition/session-owner'
import { ImagePullError } from '../../execution/docker/image-pull'
import { CountingIds, openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { birthInCloud, EBirthFault, type BirthArgs } from '../cloud-birth'
import type { CloudBridge } from '../cloud-bridge'
import { ECloudSandboxState } from '../sandbox-client'

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

const NO_ADAPTERS = {} as never
const THREAD = toThreadId('thr_birth')

const bridgeThat = (create: () => Promise<{ url: string; token: string }>): CloudBridge => ({
  sandboxes: {
    create: async () => ({ ...(await create()), state: ECloudSandboxState.Running, created: true }),
  } as unknown as CloudBridge['sandboxes'],
  attach: () => ({ channel: {} }) as unknown as ReturnType<CloudBridge['attach']>,
})

const sandboxed = bridgeThat(async () => ({ url: 'https://sandbox.test', token: 'tok' }))

async function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  const placement = new PlacementController()
  placement.bind({ threads: fixture.threads, workspace: '/work', repo: null })
  const owner = createSessionOwner<SessionRuntime>({ placement })
  await owner.placement.activate({ threadId: THREAD })
  const birthArgs = (overrides: Partial<BirthArgs>): BirthArgs => ({
    threadId: THREAD,
    cwd: tmpdir(),
    identity: { workspace: '/work', repo: null },
    model: { ref: 'anthropic/claude', effort: 'medium' },
    bridge: sandboxed,
    localThreads: fixture.threads,
    localLog: fixture.log,
    ids: new CountingIds('birth'),
    placement: owner,
    captureContext: async () => undefined,
    open: async ({ prepareRuntime }) =>
      prepareRuntime({ kind: ERuntimeKind.Cloud, cwd: '/sandbox', adapters: NO_ADAPTERS }),
    ...overrides,
  })
  return { fixture, birthArgs }
}

describe('birthInCloud', () => {
  it('writes the runner onto the local thread once the placement is committed', async () => {
    const { fixture, birthArgs } = await setup()

    const result = await birthInCloud(birthArgs({ runner: ERunner.Local }))

    expect(result.ok).toBe(true)
    const found = await fixture.threads.find({ threadId: THREAD })
    expect(found?.runner).toBe(ERunner.Local)
    expect(found?.executionLocation).toBe(EExecutionLocation.Cloud)
  })

  it('leaves the runner unset when the birth names none', async () => {
    const { fixture, birthArgs } = await setup()

    await birthInCloud(birthArgs({}))

    expect((await fixture.threads.find({ threadId: THREAD }))?.runner).toBeUndefined()
  })

  it('reports an image pull failure as its own fault', async () => {
    const { birthArgs } = await setup()
    const failing = bridgeThat(async () => {
      throw new ImagePullError({ image: 'ghcr.io/acme/atlas-sandbox:latest', cause: new Error('unreachable') })
    })

    const result = await birthInCloud(birthArgs({ bridge: failing, runner: ERunner.Local }))

    expect(result).toMatchObject({ ok: false, fault: EBirthFault.ImagePull })
    expect(result.ok ? '' : result.detail).toContain('ghcr.io/acme/atlas-sandbox:latest')
  })

  it('does not stamp a runner on a birth that failed', async () => {
    const { fixture, birthArgs } = await setup()
    const failing = bridgeThat(async () => {
      throw new Error('sandbox boom')
    })

    const result = await birthInCloud(birthArgs({ bridge: failing, runner: ERunner.Local }))

    expect(result).toMatchObject({ ok: false, fault: EBirthFault.Sandbox })
    expect((await fixture.threads.find({ threadId: THREAD }))?.runner).toBeUndefined()
  })
})
