import { describe, expect, it } from 'bun:test'

import type { UploadPlacement } from '../placement'
import {
  UPLOAD_PLACEMENT_KIND,
  placementFactOf,
  uploadPlacementsOf,
  uploadPlacementKeyOf,
} from '../placement-facts'
import { EUploadState } from '../placement'

const FILE_A = '0b9f3c1e-5d2a-4c8e-9a41-7e6d2f8b1a30'
const FILE_B = '1c0a4d2f-6e3b-4d9f-8b52-8f7e3a9c2b41'
const PATH_A = `/atlas/home/uploads/${FILE_A}/a.sh`

const placementOf = (placement: UploadPlacement) => placementFactOf({ fileId: FILE_A, placement })

describe('placementFactOf', () => {
  it('writes a ready placement under the file id key', () => {
    expect(placementOf({ state: EUploadState.Ready, path: PATH_A })).toEqual({
      type: 'fact-recorded',
      key: `upload:${FILE_A}`,
      kind: UPLOAD_PLACEMENT_KIND,
      value: { state: EUploadState.Ready, path: PATH_A },
    })
  })

  it('writes a missing placement with no path', () => {
    expect(placementOf({ state: EUploadState.Missing }).value).toEqual({
      state: EUploadState.Missing,
    })
  })
})

describe('uploadPlacementsOf', () => {
  it('projects every placement fact onto its file id', () => {
    const placements = uploadPlacementsOf([
      placementOf({ state: EUploadState.Ready, path: PATH_A }),
      placementFactOf({ fileId: FILE_B, placement: { state: EUploadState.Missing } }),
    ])

    expect(placements.get(FILE_A)).toEqual({ state: EUploadState.Ready, path: PATH_A })
    expect(placements.get(FILE_B)).toEqual({ state: EUploadState.Missing })
    expect(placements.size).toBe(2)
  })

  it('takes the last placement of a file', () => {
    const placements = uploadPlacementsOf([
      placementFactOf({ fileId: FILE_A, placement: { state: EUploadState.Missing } }),
      placementOf({ state: EUploadState.Ready, path: PATH_A }),
    ])

    expect(placements.get(FILE_A)).toEqual({ state: EUploadState.Ready, path: PATH_A })
  })

  it('skips a fact of another kind, another key and a value it cannot read', () => {
    const placements = uploadPlacementsOf([
      { type: 'fact-recorded', key: `upload:${FILE_A}`, kind: 'latch', value: { state: 'ready' } },
      { type: 'fact-recorded', key: 'base:/w', kind: UPLOAD_PLACEMENT_KIND, value: 'nonsense' },
      { type: 'fact-recorded', key: `upload:${FILE_B}`, kind: UPLOAD_PLACEMENT_KIND, value: 'x' },
      {
        type: 'fact-recorded',
        key: 'upload:',
        kind: UPLOAD_PLACEMENT_KIND,
        value: { state: 'missing' },
      },
    ])

    expect(placements.size).toBe(0)
  })
})

describe('uploadPlacementKeyOf', () => {
  it('keeps the file id inside the key', () => {
    expect(uploadPlacementKeyOf(FILE_A)).toBe(`upload:${FILE_A}`)
  })
})
