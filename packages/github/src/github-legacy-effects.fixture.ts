import type { GithubLegacyEffects } from './github-legacy-effects'

export function legacyOf(args: {
  signals: { threadChanged(args: { threadId: string }): void }
  wake: Pick<GithubLegacyEffects, 'notifyEvent'>
}): GithubLegacyEffects {
  return {
    threadChanged: (changed) => args.signals.threadChanged(changed),
    notifyEvent: (notice, event) => args.wake.notifyEvent(notice, event),
  }
}

export type WakeStub = Pick<GithubLegacyEffects, 'notifyEvent'>
