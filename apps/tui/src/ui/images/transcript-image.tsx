import { isWarpTerminal } from '@dltech/atlas-core'
import { ImageRenderable, type OptimizedBuffer } from '@opentui/core'
import { extend } from '@opentui/react'

import { transcriptRows, transcriptTop } from '../viewport-rows-store'
import { imageProtocolOf } from './protocol'

/**
 * A picture that paints its visible crop everywhere except the one path that mishandles crops.
 *
 * Warp's kitty implementation accepts a placement's cell box but discards its source rectangle, so
 * a half-scrolled image arrives as the whole picture crushed into the rows that remain rather than
 * as the crop that was asked for. Measured on Warp v0.2026.08.19: a placement of `y=200,h=200`
 * against a four-band image painted all four bands, not the requested bottom half. The block
 * sampler draws into the text buffer, which OpenTUI crops itself, and kitty/sixel on other
 * terminals honor source rectangles, so only kitty under Warp is withheld when clipped. Everywhere
 * else a half-scrolled picture shows its visible half.
 */
export class TranscriptImageRenderable extends ImageRenderable {
  override get effectiveProtocol(): 'kitty' | 'sixel' | 'blocks' {
    if (this.protocol !== 'auto') return super.effectiveProtocol
    return imageProtocolOf({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM }, fallback: super.effectiveProtocol })
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (this.wouldBeMishandledCrop()) return
    super.renderSelf(buffer)
  }

  private wouldBeMishandledCrop(): boolean {
    if (this.effectiveProtocol !== 'kitty') return false
    if (!isWarpTerminal({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM } })) return false
    return this.wouldBeCropped()
  }

  private wouldBeCropped(): boolean {
    const rows = transcriptRows()
    if (rows < 1) return false

    const top = transcriptTop()
    return this.y < top || this.y + this.height > top + rows
  }
}

declare module '@opentui/react' {
  interface OpenTUIComponents {
    'transcript-image': typeof TranscriptImageRenderable
  }
}

extend({ 'transcript-image': TranscriptImageRenderable })
