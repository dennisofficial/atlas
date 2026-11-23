export const EPreviewTunnelState = {
  Pending: 'Pending',
  Ready: 'Ready',
  Deleting: 'Deleting',
} as const

export type EPreviewTunnelState = (typeof EPreviewTunnelState)[keyof typeof EPreviewTunnelState]
