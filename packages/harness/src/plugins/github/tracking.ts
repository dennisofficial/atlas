import {
  enteredWorktreeOf,
  exitedWorktreeOf,
  toThreadId,
  type AfterTool,
  type AfterTurn,
  type BeforeTurn,
  type OnThreadOpen,
  type ThreadId,
} from '@dltech/atlas-core'

import { probeCheckout } from './checkout-probe'
import { createFamilyTracker, type FamilyTracker } from './family-tracker'
import type { RepositoryCheckout } from './pure'
import type { PullRequestService } from './pull-request-service'
import type { SessionFacts } from './session'

export type CheckoutTracking = {
  tracker: FamilyTracker
  beforeTurn: BeforeTurn
  afterTurn: AfterTurn
  threadOpened: OnThreadOpen
  followWorktree: AfterTool
  boot: () => Promise<void>
}

const BOOT_THREAD = toThreadId('boot')

/**
 * The serve process has no surface to call `track`, so the hooks do it: every thread's turn start
 * probes the directory it works in (a real checkout inside a sandbox, where `git` answers) and its
 * turn end re-probes, because the model can `git checkout -b` mid-turn. The refresh is awaited on
 * a branch hop so `record-pull-request`, which sorts after this hook, reads the new branch's
 * answer rather than an empty slot.
 *
 * Teammates are threads of the same session, so each keeps its own place: a teammate in another
 * worktree is tracked beside the main thread rather than instead of it. The cloud fold is the main
 * thread's alone — it is the lift marker's checkout, which no teammate necessarily shares.
 */
export function createCheckoutTracking(args: {
  service: PullRequestService
  facts: SessionFacts
  cloud?: () => RepositoryCheckout | null
  probe?: typeof probeCheckout
}): CheckoutTracking {
  const probe = args.probe ?? probeCheckout
  const tracker = createFamilyTracker({ service: args.service })
  const directories = new Map<ThreadId, string>()
  const homes = new Map<ThreadId, string>()
  let mainThread: ThreadId | null = null

  const resolve = async (request: {
    threadId: ThreadId
    directory: string
  }): Promise<RepositoryCheckout | null> => {
    if (args.cloud !== undefined && (request.threadId === mainThread || request.threadId === BOOT_THREAD)) {
      // The arrival/lift marker is a snapshot: a thread that reaches the cloud before its
      // worktree exists folds null forever unless the sandbox's real directory is probed.
      const folded = args.cloud()
      if (folded !== null) return folded
    }

    return probe({ directory: request.directory })
  }

  const follow = async (request: { threadId: ThreadId; directory: string }): Promise<boolean> => {
    directories.set(request.threadId, request.directory)
    if (!homes.has(request.threadId)) homes.set(request.threadId, request.directory)

    const checkout = await resolve(request)
    return tracker.place({ threadId: request.threadId, checkout })
  }

  const adoptMain = (threadId: ThreadId): void => {
    if (mainThread !== null) return

    mainThread = threadId
    tracker.adopt({ from: BOOT_THREAD, to: threadId })
  }

  return {
    tracker,
    /**
     * A clientless serve boot reaches no hook until the first turn, so the launch directory is
     * probed once at compose, under a placeholder the first real thread takes over. A directory
     * that is not a checkout places nothing: boot must not undo tracking a live surface set up.
     */
    boot: async () => {
      const directory = args.facts.directory()
      const checkout = await resolve({ threadId: BOOT_THREAD, directory })
      if (checkout === null) return

      tracker.place({ threadId: BOOT_THREAD, checkout })
      if (!tracker.hasVisibleThread()) tracker.show({ threadId: BOOT_THREAD })
    },
    beforeTurn: async ({ threadId, projectDirectory }) => {
      adoptMain(threadId)
      await follow({ threadId, directory: projectDirectory })
      if (!tracker.hasVisibleThread()) tracker.show({ threadId })
      return {}
    },
    threadOpened: async ({ threadId, projectDirectory }) => {
      adoptMain(threadId)
      await follow({ threadId, directory: projectDirectory })
      tracker.show({ threadId })
      return {}
    },
    followWorktree: async ({ call, result }) => {
      if (!result.ok) return {}

      const entered = enteredWorktreeOf(result.output)
      const exited = exitedWorktreeOf(result.output)
      const directory =
        entered !== undefined
          ? entered.path
          : exited !== undefined
            ? (exited.returnTo ?? homes.get(call.threadId))
            : undefined
      if (directory === undefined) return {}

      await follow({ threadId: call.threadId, directory })
      return {}
    },
    afterTurn: async ({ threadId }) => {
      const directory = directories.get(threadId)
      if (directory === undefined) return {}

      const moved = await follow({ threadId, directory })
      const checkout = tracker.checkoutFor({ threadId })
      if (moved && checkout !== null) await args.service.refresh({ checkout, force: true })

      return {}
    },
  }
}
