import { ImageRenderable, type TerminalCapabilities } from '@opentui/core'
import { extend } from '@opentui/react'

import { imageProtocolOf } from './protocol'

/**
 * What the viewer would paint with, given the terminal's answer set. The blocks sampler writes
 * past a renderable's box in xterm.js (no pixel channel), so the viewer declines rather than
 * paint garbage — this helper exists so the component and the renderable agree on the answer.
 */
export function viewerImageProtocol(args: {
  capabilities: TerminalCapabilities | null
  hasResolution: boolean
}): 'kitty' | 'sixel' | 'blocks' {
  const { capabilities, hasResolution } = args
  if (capabilities === null || capabilities.multiplexer === 'tmux') {
    return imageProtocolOf({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM }, fallback: 'blocks' })
  }
  if (capabilities.kitty_graphics) {
    return imageProtocolOf({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM }, fallback: 'kitty' })
  }
  if (capabilities.sixel && hasResolution) {
    return imageProtocolOf({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM }, fallback: 'sixel' })
  }
  return imageProtocolOf({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM }, fallback: 'blocks' })
}

/**
 * The context viewer's picture. Unlike the transcript's it owns its whole pane, so there is no
 * scroll position to survive — only Warp's half-spoken kitty claim to route around. The pane lays
 * it out with flexGrow between the header and footer, and `fit` keeps the picture contained and
 * centred inside whatever box that grants.
 */
export class ViewerImageRenderable extends ImageRenderable {
  override get effectiveProtocol(): 'kitty' | 'sixel' | 'blocks' {
    if (this.protocol !== 'auto') return super.effectiveProtocol
    return imageProtocolOf({ env: { TERM_PROGRAM: process.env.TERM_PROGRAM }, fallback: super.effectiveProtocol })
  }
}

declare module '@opentui/react' {
  interface OpenTUIComponents {
    'viewer-image': typeof ViewerImageRenderable
  }
}

extend({ 'viewer-image': ViewerImageRenderable })
