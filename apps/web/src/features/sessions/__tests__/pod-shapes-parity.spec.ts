import { describe, expect, it } from 'bun:test'

import { AGENT37_POD_SHAPES, VERCEL_POD_SHAPES } from '@dltech/atlas-core'

import {
  AGENT37_POD_SHAPES as UI_AGENT37_POD_SHAPES,
  vercelPodShapesOf,
} from '../../../../../../packages/ui/src/ai/pod-shapes'

describe('pod shapes', () => {
  it('offers the same Agent37 shapes as the UI', () => {
    expect(UI_AGENT37_POD_SHAPES).toEqual(AGENT37_POD_SHAPES)
  })

  it('offers the same Vercel shapes as the UI', () => {
    expect(vercelPodShapesOf({ maxVcpus: 32 })).toEqual(VERCEL_POD_SHAPES)
  })
})
