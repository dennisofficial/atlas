import type { LinkedPullRequest } from '@dltech/atlas-core'

import type { PluginProjection } from '../projection'
import type { PullRequestService } from './pull-request-service'
import type { SessionFacts } from './session'

/**
 * The live polling this plugin owns has nowhere honest to run except behind a rendered surface: the
 * checkout it should track is discovered by probing git from a React effect, not by anything the
 * hook phases carry. `contribute()` builds `service`/`facts`/`links` once and this port is how the
 * TUI, which alone renders that surface, reaches the same instances rather than standing up a
 * second poller of its own.
 */
export abstract class GithubUiBridgePort {
  abstract readonly service: PullRequestService
  abstract readonly facts: SessionFacts
  abstract readonly links: PluginProjection<readonly LinkedPullRequest[]>
}
