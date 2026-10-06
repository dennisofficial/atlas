import {
  ImageRenderable,
  resolveImageRenderProtocol,
  type ImageRenderableOptions,
  type ImageRenderProtocol,
  type OptimizedBuffer,
  type RenderContext,
} from '@opentui/core'

import { imageProtocolOf } from './protocol'

export class TerminalImageRenderable extends ImageRenderable {
  private requestedProtocol: ImageRenderProtocol

  constructor(ctx: RenderContext, options: ImageRenderableOptions) {
    super(ctx, options)
    this.requestedProtocol = options.protocol ?? 'auto'
  }

  override get protocol(): ImageRenderProtocol {
    return this.requestedProtocol
  }

  override set protocol(value: ImageRenderProtocol | null | undefined) {
    this.requestedProtocol = value ?? 'auto'
    super.protocol = value
  }

  override get effectiveProtocol(): 'kitty' | 'sixel' | 'blocks' {
    const resolution = this.ctx.resolution
    const hasResolution =
      (this.ctx.terminalWidth ?? 0) > 0 &&
      (this.ctx.terminalHeight ?? 0) > 0 &&
      resolution !== null &&
      resolution !== undefined &&
      resolution.width > 0 &&
      resolution.height > 0
    const fallback = resolveImageRenderProtocol(this.requestedProtocol, this.ctx.capabilities, hasResolution)
    if (this.requestedProtocol !== 'auto') return fallback
    return imageProtocolOf({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM }, fallback })
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    // OpenTUI 0.5.12 draws with its private protocol, bypassing effectiveProtocol:
    // https://github.com/anomalyco/opentui/blob/v0.5.12/packages/core/src/renderables/Image.ts
    super.protocol = this.effectiveProtocol
    super.renderSelf(buffer)
  }
}
