import {
  EExecutionLocation,
  EPlacementMovePhase,
  locationOfPlacement,
  type PlacementRecord,
} from '@dltech/atlas-core'

export enum ERecoveryAction {
  None = 'none',
  KeepSource = 'keep-source',
  ResumeSource = 'resume-source',
  ActivateCloud = 'activate-cloud',
  BindLocal = 'bind-local',
}

export function recoveryActionOf(record: PlacementRecord): ERecoveryAction {
  if (record.move === null) return ERecoveryAction.None
  const cloud = locationOfPlacement(record.placement) === EExecutionLocation.Cloud
  if (record.move.phase === EPlacementMovePhase.Preparing) {
    return cloud ? ERecoveryAction.ResumeSource : ERecoveryAction.KeepSource
  }
  return cloud ? ERecoveryAction.ActivateCloud : ERecoveryAction.BindLocal
}
