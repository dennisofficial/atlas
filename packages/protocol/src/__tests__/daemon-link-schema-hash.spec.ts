import { describe, expect, it } from 'bun:test'

import { hostFrameSchemaHash } from '../engine/daemon-link-skew'
import { DAEMON_LINK_SCHEMA_HASH } from '../daemon-port'

const MATCHES = 'DAEMON_LINK_SCHEMA_HASH matches hostFrameSchema'

describe('DAEMON_LINK_SCHEMA_HASH', () => {
  it('pins the host to daemon frame schema, so a changed frame cannot ship without a bump', () => {
    const live = hostFrameSchemaHash()

    expect(
      live === DAEMON_LINK_SCHEMA_HASH
        ? MATCHES
        : `hostFrameSchema changed. Set DAEMON_LINK_SCHEMA_HASH to ${live}, then raise DAEMON_LINK_PROTOCOL_VERSION and DAEMON_LINK_PROTOCOL_MIN_VERSION by one so hosts restart the daemons that cannot read the new frames.`,
    ).toBe(MATCHES)
  })
})
