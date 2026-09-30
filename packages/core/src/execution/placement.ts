import { EExecutionLocation } from './location'

export enum EHarnessPlacement {
  Host = 'host',
  Cloud = 'cloud',
}

export enum EToolEnvironment {
  Host = 'host',
  Docker = 'docker',
}

export type SessionPlacement =
  | { harness: EHarnessPlacement.Host; tools: EToolEnvironment }
  | { harness: EHarnessPlacement.Cloud; driveName?: string | undefined }

export enum EPlacementMovePhase {
  Preparing = 'preparing',
  Committed = 'committed',
}

export type PlacementMove = {
  id: string
  from: SessionPlacement
  to: SessionPlacement
  phase: EPlacementMovePhase
}

export type PlacementRecord = {
  placement: SessionPlacement
  revision: number
  move: PlacementMove | null
}

export function placementOf(location: EExecutionLocation): SessionPlacement {
  if (location === EExecutionLocation.Cloud) return { harness: EHarnessPlacement.Cloud }
  return {
    harness: EHarnessPlacement.Host,
    tools: location === EExecutionLocation.Docker ? EToolEnvironment.Docker : EToolEnvironment.Host,
  }
}

export function locationOfPlacement(placement: SessionPlacement): EExecutionLocation {
  if (placement.harness === EHarnessPlacement.Cloud) return EExecutionLocation.Cloud
  return placement.tools === EToolEnvironment.Docker ? EExecutionLocation.Docker : EExecutionLocation.Host
}
