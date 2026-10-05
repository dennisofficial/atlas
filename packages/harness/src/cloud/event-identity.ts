import { transcriptIdentityDigest as digestIdentities } from '@dltech/atlas-core'

import type { Event } from '@dltech/atlas-core'

export const transcriptIdentityDigest = (events: readonly Event[]): string =>
  digestIdentities(events)
