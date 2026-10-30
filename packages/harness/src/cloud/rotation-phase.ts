import { ERotationPhase } from '../rotation/rotation-port'
import { EWireRotationPhase } from '@dltech/atlas-wire'

export const stagePhaseOfWire = (phase: EWireRotationPhase): ERotationPhase => {
  switch (phase) {
    case EWireRotationPhase.Settling:
      return ERotationPhase.Settling
    case EWireRotationPhase.Summarising:
      return ERotationPhase.Summarising
    case EWireRotationPhase.Compacting:
      return ERotationPhase.Compacting
    case EWireRotationPhase.Done:
      return ERotationPhase.Done
    case EWireRotationPhase.Failed:
      return ERotationPhase.Failed
  }
}
