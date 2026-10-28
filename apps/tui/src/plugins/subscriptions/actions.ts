import {
  ENoticeTone,
  ESubscriptionActor,
  ESubscriptionStatus,
  type NoticePort,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  PULL_REQUEST_PROVIDER_KIND,
  type SubscriptionRegistryPort,
  type SubscriptionView,
} from '@dltech/atlas-harness'

const NOTICE_KEY = 'subscriptions'

const GITHUB_HOST_PREFIX = 'github.com/'

export const inputOf = (args: { repo: string; number: number }): string =>
  `${args.repo.startsWith(GITHUB_HOST_PREFIX) ? args.repo.slice(GITHUB_HOST_PREFIX.length) : args.repo}#${args.number}`

export type SubscriptionActions = {
  toggle: (view: SubscriptionView) => void
  remove: (view: SubscriptionView) => void
  ring: (args: {
    threadId: ThreadId
    repo: string
    number: number
    projectDirectory: string
    existing: SubscriptionView | null
  }) => void
}

export function createSubscriptionActions(args: {
  registry: SubscriptionRegistryPort
  notice: NoticePort
}): SubscriptionActions {
  const { registry, notice } = args

  const warn = (text: string): void =>
    notice.notify({ text, tone: ENoticeTone.Warn, key: NOTICE_KEY })

  const attempt = (work: () => Promise<string | null>): void => {
    work()
      .then((failure) => {
        if (failure !== null) warn(failure)
      })
      .catch((error: unknown) => {
        warn(error instanceof Error ? error.message : 'subscription change failed')
      })
  }

  const removed = async (view: SubscriptionView): Promise<string | null> =>
    (await registry.unsubscribe({ subscriptionId: view.id, by: ESubscriptionActor.Operator }))
      ? null
      : 'subscription already gone'

  return {
    toggle: (view) =>
      attempt(async () =>
        (await registry.setStatus({
          subscriptionId: view.id,
          status:
            view.status === ESubscriptionStatus.Paused
              ? ESubscriptionStatus.Active
              : ESubscriptionStatus.Paused,
          by: ESubscriptionActor.Operator,
        }))
          ? null
          : 'subscription already gone',
      ),
    remove: (view) => attempt(() => removed(view)),
    ring: (ring) =>
      attempt(async () => {
        if (ring.existing !== null) return removed(ring.existing)

        const outcome = await registry.subscribe({
          threadId: ring.threadId,
          provider: PULL_REQUEST_PROVIDER_KIND,
          input: inputOf(ring),
          projectDirectory: ring.projectDirectory,
          by: ESubscriptionActor.Operator,
        })
        return outcome.ok ? null : outcome.error
      }),
  }
}
