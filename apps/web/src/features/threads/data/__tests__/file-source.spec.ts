import { describe, expect, it } from 'bun:test'
import { POD_PARKED_MESSAGE } from '@dltech/atlas-protocol'
import { CloudApiError } from '@/lib/cloud-api'

import { channelFileSource, isPodParked } from '../file-source'

describe('channelFileSource', () => {
  it('calls the three v1 functions through the channel', async () => {
    const requests: unknown[] = []
    const channel = {
      async request(args: unknown) {
        requests.push(args)
        const { op } = args as { op: string }
        if (op === 'browse-directory')
          return { directory: '', entries: [{ name: 'src', isDirectory: true }] }
        if (op === 'search-workspace-files') return { paths: [], truncated: false }
        return { file: { type: 'refused', path: 'a.ts', reason: 'nope' } }
      },
    }
    const source = channelFileSource(channel as never)
    expect(await source.browse({ directory: '' })).toEqual([{ name: 'src', isDirectory: true }])
    expect(await source.search({ query: 'a' })).toEqual({ paths: [], truncated: false })
    expect(await source.read({ path: 'a.ts' })).toEqual({
      type: 'refused',
      path: 'a.ts',
      reason: 'nope',
    })
    expect(requests).toHaveLength(3)
  })
})

describe('isPodParked', () => {
  it('recognises the parked failure', () => {
    expect(isPodParked(new CloudApiError({ message: POD_PARKED_MESSAGE, status: 412 }))).toBe(true)
  })

  it('leaves other failures alone', () => {
    expect(isPodParked(new CloudApiError({ message: 'nope', status: 500 }))).toBe(false)
    expect(isPodParked(new Error(POD_PARKED_MESSAGE))).toBe(false)
  })
})
