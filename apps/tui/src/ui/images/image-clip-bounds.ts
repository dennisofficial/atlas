import { BoxRenderable, getBorderSides, type Renderable } from '@opentui/core'

import type { ImageRectangle } from './image-placement'

export function imageClipBounds(args: {
  node: Renderable
  buffer: { width: number; height: number }
  origin: { x: number; y: number }
}): ImageRectangle {
  let left = Math.max(0, args.origin.x)
  let top = Math.max(0, args.origin.y)
  let right = Math.min(args.node.ctx.width, args.origin.x + args.buffer.width)
  let bottom = Math.min(args.node.ctx.height, args.origin.y + args.buffer.height)
  for (let parent = args.node.parent; parent !== null; parent = parent.parent) {
    if (parent.overflow === 'visible' || parent.width <= 0 || parent.height <= 0) continue
    const border = getBorderSides(parent instanceof BoxRenderable ? parent.border : false)
    left = Math.max(left, parent.screenX + Number(border.left))
    top = Math.max(top, parent.screenY + Number(border.top))
    right = Math.min(right, parent.screenX + parent.width - Number(border.right))
    bottom = Math.min(bottom, parent.screenY + parent.height - Number(border.bottom))
  }
  return {
    x: left - args.origin.x,
    y: top - args.origin.y,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}
