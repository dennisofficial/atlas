export const EPreviewTunnelState = {
  Pending: 'Pending',
  Creating: 'Creating',
  Ready: 'Ready',
  Deleting: 'Deleting',
} as const

export type EPreviewTunnelState = (typeof EPreviewTunnelState)[keyof typeof EPreviewTunnelState]
