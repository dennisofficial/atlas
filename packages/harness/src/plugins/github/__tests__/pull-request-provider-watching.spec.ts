import { describe, expect, it } from 'bun:test'

import { createPullRequestProvider } from '../pull-request-provider'
import { createPullRequestService } from '../pull-request-service'
import { aCheckout, pullRequestsAnswering, WAS_ABSENT, wasFound } from '../testing'
import { harness, REPO, TARGET, THREAD } from './provider-fixtures'

describe('the pull request provider’s watched set and target resolution', () => {
  describe('which pull requests are watched', () => {
    it('answers subscribed from the started set', () => {
      const { provider, started } = harness()
      expect(provider.subscribed(TARGET)).toBe(false)

      const stop = started()
      expect(provider.subscribed(TARGET)).toBe(true)
      expect(provider.subscribed({ repo: REPO, number: 7 })).toBe(false)

      stop()
      expect(provider.subscribed(TARGET)).toBe(false)
    })

    it('publishes the extra watch set on start and takes it back on stop', () => {
      const { targets, started } = harness()

      const stop = started()
      expect(targets.at(-1)).toEqual([TARGET])

      stop()
      expect(targets.at(-1)).toEqual([])
    })

    it('keeps watching until the last subscription on a pull request stops', () => {
      const { provider, targets, started } = harness()
      const first = started({ id: 'a' })
      const second = started({ id: 'b' })

      first()
      expect(provider.subscribed(TARGET)).toBe(true)
      expect(targets.at(-1)).toEqual([TARGET])

      second()
      expect(provider.subscribed(TARGET)).toBe(false)
      expect(targets.at(-1)).toEqual([])
    })
  })

  describe('resolving a target', () => {
    it('uses the thread’s tracked checkout and its found pull request', async () => {
      const checkout = aCheckout({ branch: 'dennis/x' })
      const service = createPullRequestService({
        pullRequests: pullRequestsAnswering(wasFound({ number: 9 })),
      })
      service.track({ checkouts: [checkout] })
      await service.refresh({ checkout, force: true })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const provider = createPullRequestProvider({
        tracker: { checkoutFor: () => checkout },
        service,
        onTargets: () => undefined,
        probe: async () => null,
      })

      const resolved = await provider.resolve({
        input: '',
        threadId: THREAD,
        projectDirectory: '/work/atlas',
      })

      expect(resolved).toEqual({
        target: { repo: REPO, number: 9 },
        label: 'dennisofficial/atlas#9',
      })
      service.dispose()
    })

    it('falls back to probing the project directory when the tracker has no place for the thread', async () => {
      const probed: string[] = []
      const service = createPullRequestService({ pullRequests: pullRequestsAnswering(wasFound()) })
      const provider = createPullRequestProvider({
        tracker: { checkoutFor: () => null },
        service,
        onTargets: () => undefined,
        probe: async ({ directory }) => {
          probed.push(directory)
          return aCheckout()
        },
      })

      const resolved = await provider.resolve({
        input: '#5',
        threadId: THREAD,
        projectDirectory: '/work/elsewhere',
      })

      expect(probed).toEqual(['/work/elsewhere'])
      expect(resolved).toEqual({
        target: { repo: REPO, number: 5 },
        label: 'dennisofficial/atlas#5',
      })
      service.dispose()
    })

    it('forces one fresh read of the checkout when a blank target finds no pull request yet', async () => {
      const checkout = aCheckout({ branch: 'dennis/x' })
      const port = pullRequestsAnswering(wasFound({ number: 9 }))
      const service = createPullRequestService({ pullRequests: port })
      const provider = createPullRequestProvider({
        tracker: { checkoutFor: () => checkout },
        service,
        onTargets: () => undefined,
        probe: async () => null,
      })

      const resolved = await provider.resolve({
        input: '',
        threadId: THREAD,
        projectDirectory: '/work/atlas',
      })

      expect(resolved).toEqual({
        target: { repo: REPO, number: 9 },
        label: 'dennisofficial/atlas#9',
      })
      expect(port.asked).toHaveLength(1)
      service.dispose()
    })

    it('still refuses a blank target when the fresh read finds no pull request either', async () => {
      const checkout = aCheckout({ branch: 'dennis/x' })
      const port = pullRequestsAnswering(WAS_ABSENT)
      const service = createPullRequestService({ pullRequests: port })
      const provider = createPullRequestProvider({
        tracker: { checkoutFor: () => checkout },
        service,
        onTargets: () => undefined,
        probe: async () => null,
      })

      const resolved = await provider.resolve({
        input: '',
        threadId: THREAD,
        projectDirectory: '/work/atlas',
      })

      expect('error' in resolved).toBe(true)
      expect(port.asked).toHaveLength(1)
      service.dispose()
    })

    it('does not read again when the checkout already has a found pull request', async () => {
      const checkout = aCheckout({ branch: 'dennis/x' })
      const port = pullRequestsAnswering(wasFound({ number: 9 }))
      const service = createPullRequestService({ pullRequests: port })
      service.track({ checkouts: [checkout] })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const provider = createPullRequestProvider({
        tracker: { checkoutFor: () => checkout },
        service,
        onTargets: () => undefined,
        probe: async () => null,
      })

      await provider.resolve({ input: '', threadId: THREAD, projectDirectory: '/work/atlas' })

      expect(port.asked).toHaveLength(1)
      service.dispose()
    })

    it('passes a resolution error through', async () => {
      const { provider } = harness()

      const resolved = await provider.resolve({
        input: '',
        threadId: THREAD,
        projectDirectory: '/nowhere',
      })

      expect('error' in resolved).toBe(true)
    })
  })
})
