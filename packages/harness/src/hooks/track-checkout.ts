import {
  AfterToolHook,
  EStage,
  OnThreadOpenHook,
  enteredWorktreeOf,
  exitedWorktreeOf,
  type AfterTool,
  type EventLogPort,
  type EventDraft,
  type HookOrder,
  type HookOutcome,
  type OnThreadOpen,
  type ProcessPort,
  type ThreadId,
} from '@dltech/atlas-core'

import { probeCheckout } from './checkout-probe'

const BASH_TOOL = 'bash'

type Observer = { process: ProcessPort; log: EventLogPort }

async function observation({
  observer,
  threadId,
  path,
}: {
  observer: Observer
  threadId: ThreadId
  path: string
}): Promise<HookOutcome> {
  const probed = await probeCheckout({ process: observer.process, cwd: path, threadId })
  if (probed === undefined) return {}

  const events = await observer.log.readOwn({ threadId })
  const latest = events.findLast((event) => event.type === 'checkout-observed')
  if (
    latest?.type === 'checkout-observed' &&
    latest.path === path &&
    latest.branch === probed.branch &&
    latest.detached === probed.detached
  ) {
    return {}
  }
  const draft: EventDraft = { type: 'checkout-observed', path, ...probed }
  return { drafts: [draft] }
}

export class TrackCheckoutHook extends AfterToolHook {
  readonly name = 'track-checkout'
  readonly order: HookOrder = { stage: EStage.Observe, nudge: 2 }

  constructor(private readonly observer: Observer) {
    super()
  }

  readonly run: AfterTool = async ({ call, result, projectDirectory }) => {
    const threadId = call.threadId
    if (call.name === BASH_TOOL) {
      return observation({ observer: this.observer, threadId, path: projectDirectory })
    }
    if (!result.ok) return {}

    const path = enteredWorktreeOf(result.output)?.path ?? exitedWorktreeOf(result.output)?.returnTo
    if (path === undefined) return {}
    return observation({ observer: this.observer, threadId, path })
  }
}

export class OpenCheckoutHook extends OnThreadOpenHook {
  readonly name = 'open-checkout'
  readonly order: HookOrder = { stage: EStage.Observe, nudge: 2 }

  constructor(private readonly observer: Observer) {
    super()
  }

  readonly run: OnThreadOpen = ({ threadId, projectDirectory }) =>
    observation({ observer: this.observer, threadId, path: projectDirectory })
}
