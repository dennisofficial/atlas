import { describe, expect, it } from 'bun:test'

import { ESubscriptionActor } from '@dltech/atlas-core'

import { invoke, modelTextOf, reasonOf, rigOf } from './artifact-push-rig'

describe('artifact_push follows the build it started', () => {
  it('subscribes the conversation to this version of this artifact', async () => {
    const rig = rigOf()
    modelTextOf(await invoke({}, rig.tool))

    expect(rig.registry.subscribes).toHaveLength(1)
    expect(rig.registry.subscribes[0]).toMatchObject({
      provider: 'artifact.build',
      input: 'demo@3',
      projectDirectory: '/ws',
      by: ESubscriptionActor.Agent,
    })
  })

  it('says it subscribed, names the id, the url and the two outcomes', async () => {
    const rig = rigOf()
    const text = modelTextOf(await invoke({}, rig.tool))

    expect(text).toContain('the build runs on the server')
    expect(text).toContain('sub_artifact')
    expect(text).toContain('https://demo.artifacts.test')
    expect(text).toContain('End your turn rather than polling')
  })

  it('still pushes, and points at artifact_list, when the session has no registry', async () => {
    const rig = rigOf({ registry: false })
    const text = modelTextOf(await invoke({}, rig.tool))

    expect(text).toContain('artifact_list')
    expect(text).not.toContain('woken')
  })

  it('still pushes, and points at artifact_list, when the subscription is refused', async () => {
    const rig = rigOf()
    rig.registry.refusal = 'no such provider'
    const text = modelTextOf(await invoke({}, rig.tool))

    expect(text).toContain('no such provider')
    expect(text).toContain('artifact_list')
  })

  it('fails the push when the server could not start the build', async () => {
    const rig = rigOf()
    rig.port.commitStatus = 'failed'

    const outcome = await invoke({}, rig.tool)

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('could not start its build')
    expect(rig.registry.subscribes).toHaveLength(0)
  })
})
