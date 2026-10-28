import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, ERunner, toThreadId } from '@dltech/atlas-core'

import { PlacementController } from '../../composition/placement-controller'
import {
  createSessionOwner,
  ERuntimeKind,
  type SessionRuntime,
} from '../../composition/session-owner'
import { EVercelCredentialGap } from '@dltech/atlas-wire'

import { notConfiguredOf } from '../api-pod-errors'
import { ImagePullError } from '../../execution/docker/image-pull'
import { CountingIds, openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { BIRTH_WAVES, birthInCloud, EBirthFault, EBirthNode, type BirthArgs } from '../cloud-birth'
import type { CloudBridge } from '../cloud-bridge'
import { ECloudSandboxState } from '../sandbox-client'

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

const NO_ADAPTERS = {} as never
const THREAD = toThreadId('thr_birth')

const bridgeThat = (
  create: () => Promise<{ url: string; token: string }>,
  seen?: Array<{ projectId: string | null; birth?: { effort: string } | undefined }>,
): CloudBridge => ({
  sandboxes: {
    create: async (args: { projectId: string | null; birth?: { effort: string } | undefined }) => {
      seen?.push({ projectId: args.projectId, birth: args.birth })
      return { ...(await create()), state: ECloudSandboxState.Running, created: true }
    },
  } as unknown as CloudBridge['sandboxes'],
  attach: () => ({ channel: {} }) as unknown as ReturnType<CloudBridge['attach']>,
})

const sandboxed = bridgeThat(async () => ({ url: 'https://sandbox.test', token: 'tok' }))

async function setup() {
  const fixture = openStoreFixture()
  held.push(fixture)
  const placement = new PlacementController(EExecutionLocation.Host)
  placement.bind({ threads: fixture.threads, workspace: '/work', repo: null })
  const owner = createSessionOwner<SessionRuntime>({
    placement,
    local: { kind: ERuntimeKind.Local, cwd: '/work', adapters: NO_ADAPTERS },
  })
  await owner.placement.activate({ threadId: THREAD })
  const birthArgs = (overrides: Partial<BirthArgs>): BirthArgs => ({
    threadId: THREAD,
    projectId: null,
    identity: { workspace: '/work', repo: null },
    model: { ref: 'anthropic/claude', effort: 'medium' },
    bridge: sandboxed,
    localThreads: fixture.threads,
    ids: new CountingIds('birth'),
    placement: owner,
    open: async ({ prepareRuntime }) =>
      prepareRuntime({ kind: ERuntimeKind.Cloud, cwd: '/sandbox', adapters: NO_ADAPTERS }),
    ...overrides,
  })
  return { fixture, birthArgs }
}

describe('the rows a birth narrates', () => {
  it('puts every node the birth runs on a visible row', () => {
    const narrated = BIRTH_WAVES.flatMap((wave) => wave.ids)

    for (const node of Object.values(EBirthNode)) expect(narrated).toContain(node)
  })

  it('names the pod wait and the workspace setup, finishing on the last write', () => {
    expect(BIRTH_WAVES).toEqual([
      { label: 'waiting for the pod', ids: [EBirthNode.Provision] },
      {
        label: 'setting up the workspace',
        ids: [EBirthNode.Attach, EBirthNode.Open, EBirthNode.FlipOwnership],
      },
    ])
  })
})

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

  it('passes the project to the sandbox and records it on the thread', async () => {
    const { fixture, birthArgs } = await setup()
    const seen: Array<{ projectId: string | null; birth?: { effort: string } | undefined }> = []
    const bridge = bridgeThat(async () => ({ url: 'https://sandbox.test', token: 'tok' }), seen)

    const result = await birthInCloud(birthArgs({ bridge, projectId: 'proj_1' }))

    expect(result.ok).toBe(true)
    expect(seen).toEqual([{ projectId: 'proj_1', birth: { effort: 'medium' } }])
    expect((await fixture.threads.find({ threadId: THREAD }))?.projectId).toBe('proj_1')
  })

  it('leaves the thread without a project when the birth names none', async () => {
    const { fixture, birthArgs } = await setup()

    await birthInCloud(birthArgs({}))

    expect((await fixture.threads.find({ threadId: THREAD }))?.projectId).toBeUndefined()
  })

  it('reports an image pull failure as its own fault', async () => {
    const { birthArgs } = await setup()
    const failing = bridgeThat(async () => {
      throw new ImagePullError({
        image: 'ghcr.io/acme/atlas-sandbox:latest',
        cause: new Error('unreachable'),
      })
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

  it('reports an API not-configured reply as the not-configured fault, with its hint', async () => {
    const { birthArgs } = await setup()
    const failing = bridgeThat(async () => {
      throw notConfiguredOf({ gap: EVercelCredentialGap.UserCredential })
    })

    const result = await birthInCloud(birthArgs({ bridge: failing, runner: ERunner.Vercel }))

    expect(result).toMatchObject({ ok: false, fault: EBirthFault.NotConfigured })
    expect(result.ok ? '' : result.detail).toContain('Add your Vercel credentials')
  })
})
