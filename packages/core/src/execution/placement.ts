export enum EHarnessPlacement {
  Cloud = 'cloud',
}

export type SessionPlacement = { harness: EHarnessPlacement.Cloud; driveName?: string | undefined }

export type PlacementRecord = {
  placement: SessionPlacement
  revision: number
}
