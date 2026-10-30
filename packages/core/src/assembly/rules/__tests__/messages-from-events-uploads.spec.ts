import { describe, expect, it } from 'bun:test'

import { EUploadState } from '../../../uploads/placement'
import type { Assembled } from '../../assembled'
import { contextFor, log, operatorSaidAs } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'

const empty: Assembled = { system: [], messages: [] }

const PDF = {
  uploadId: 'u1',
  pathname: 'composer-uploads/user/u1/spec.pdf',
  name: 'spec.pdf',
  size: 12595,
  mediaType: 'application/pdf',
}

const textsOf = ({
  uploads,
  placements,
}: {
  uploads?: (typeof PDF)[]
  placements?: Map<
    string,
    { state: EUploadState.Ready; path: string } | { state: EUploadState.Missing }
  >
}): string[] => {
  const base = contextFor({
    events: log([{ type: 'user-said', text: 'read it', ...(uploads ? { uploads } : {}) }]),
  })
  const ctx = placements === undefined ? base : { ...base, uploads: placements }
  const content = messagesFromEvents()(empty, ctx).messages[0]?.message.content
  return (content ?? []).flatMap((part) => (part.type === 'text' ? [part.text] : []))
}

describe('a message with uploads', () => {
  it('lists the absolute path, size and type after the words', () => {
    const texts = textsOf({
      uploads: [PDF],
      placements: new Map([['u1', { state: EUploadState.Ready, path: '/s/uploads/u1/spec.pdf' }]]),
    })

    expect(texts[0]).toEqual(operatorSaidAs('read it'))
    expect(texts[1]).toContain('source="uploads"')
    expect(texts[1]).toContain(
      'The operator attached these files:\n- /s/uploads/u1/spec.pdf (12.3 KB, application/pdf)',
    )
  })

  it('says a missing file is no longer available', () => {
    const texts = textsOf({
      uploads: [PDF],
      placements: new Map([['u1', { state: EUploadState.Missing }]]),
    })

    expect(texts[1]).toContain('- spec.pdf: no longer available')
  })

  it('falls back to the relative path without a placement', () => {
    expect(textsOf({ uploads: [PDF] })[1]).toContain('- uploads/u1/spec.pdf (12.3 KB')
  })

  it('adds no block without uploads', () => {
    expect(textsOf({})).toHaveLength(1)
  })
})
