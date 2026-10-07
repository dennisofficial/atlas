import { isWarpTerminal } from '@dltech/atlas-core'
import {
  ImageRenderable,
  resolveImageRenderProtocol,
  type ImageRenderableOptions,
  type ImageRenderProtocol,
  type OptimizedBuffer,
  type RenderContext,
} from '@opentui/core'

import { imageClipBounds } from './image-clip-bounds'
import { clippedImagePlacement } from './image-placement'
import { PixelImageCache } from './pixel-image-cache'

export class TerminalImageRenderable extends ImageRenderable {
  private requestedProtocol: ImageRenderProtocol
  private readonly pixels = new PixelImageCache()

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
    return resolveImageRenderProtocol(
      this.requestedProtocol,
      this.ctx.capabilities,
      this.pixelResolution() !== null,
    )
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const protocol = this.effectiveProtocol
    if (
      protocol === 'kitty' &&
      isWarpTerminal({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM } })
    ) {
      this.renderPixels(buffer)
      return
    }
    this.pixels.clear()
    // OpenTUI 0.5.12 draws with its private protocol, bypassing effectiveProtocol:
    // https://github.com/anomalyco/opentui/blob/v0.5.12/packages/core/src/renderables/Image.ts
    super.protocol = protocol
    super.renderSelf(buffer)
  }

  private pixelResolution(): { width: number; height: number } | null {
    const resolution = this.ctx.resolution
    if (!resolution || resolution.width <= 0 || resolution.height <= 0) return null
    if ((this.ctx.terminalWidth ?? 0) <= 0 || (this.ctx.terminalHeight ?? 0) <= 0) return null
    return resolution
  }

  private renderPixels(buffer: OptimizedBuffer): void {
    const image = this.image
    if (!image || this.width <= 0 || this.height <= 0) {
      this.pixels.clear()
      return
    }
    const fitted =
      this.fit === 'cover'
        ? { width: this.width, height: this.height }
        : this.getFittedSize(this.width, this.height)
    const resolution = this.pixelResolution()
    const origin = this.buffered ? { x: this.screenX, y: this.screenY } : { x: 0, y: 0 }
    const placement = clippedImagePlacement({
      source: image,
      layout: {
        x: this.buffered ? 0 : this.screenX,
        y: this.buffered ? 0 : this.screenY,
        width: this.width,
        height: this.height,
      },
      fitted,
      fit: this.fit,
      cellAspect: this.cellAspectRatio,
      pixels: {
        width: resolution
          ? Math.max(
              1,
              Math.round((fitted.width * resolution.width) / (this.ctx.terminalWidth ?? 1)),
            )
          : 0,
        height: resolution
          ? Math.max(
              1,
              Math.round((fitted.height * resolution.height) / (this.ctx.terminalHeight ?? 1)),
            )
          : 0,
      },
      clip: imageClipBounds({
        node: this,
        buffer: {
          width: buffer.width ?? this.ctx.width,
          height: buffer.height ?? this.ctx.height,
        },
        origin,
      }),
    })
    if (!placement) {
      this.pixels.clear()
      return
    }
    const prepared = this.pixels.imageFor({ image, placement })
    const destination = placement.destination
    buffer.drawImage(
      prepared,
      destination.x,
      destination.y,
      destination.width,
      destination.height,
      placement.pixels.width,
      placement.pixels.height,
      0,
      0,
      prepared.width,
      prepared.height,
      'kitty',
    )
  }

  protected override destroySelf(): void {
    this.pixels.clear()
    super.destroySelf()
  }
}
