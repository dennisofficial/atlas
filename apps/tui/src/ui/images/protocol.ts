import { isWarpTerminal } from '@dltech/atlas-core'

export interface ProtocolEnv {
  TERM_PROGRAM?: string | undefined
}

/**
 * Warp claims kitty graphics but only half-speaks it: it drops the source rectangle on crops (see
 * transcript-image.tsx) and, worse, prints the transmission's base64 payload as literal text when
 * the stream backpressures — which it does every frame an image is on screen during an active
 * turn. Measured on Warp v0.2026.09; the fix belongs to Warp, not to retransmission tuning, so
 * auto resolves to the block sampler there. Every other terminal keeps OpenTUI's own resolution.
 */
export function imageProtocolOf(args: {
  env: ProtocolEnv
  fallback: 'kitty' | 'sixel' | 'blocks'
}): 'kitty' | 'sixel' | 'blocks' {
  if (isWarpTerminal({ env: args.env })) return 'blocks'
  return args.fallback
}
