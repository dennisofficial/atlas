export type TransferProgress = {
  transferredBytes: number
  totalBytes?: number | undefined
  complete: boolean
}

export type SandboxTransferProgress = TransferProgress & {
  transferId: string
  label: string
}

export type RelocationTransferProgress = SandboxTransferProgress & {
  nodeId: string
}
