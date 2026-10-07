import { ERotationPhase } from '@dltech/atlas-harness'
import { EWireRotationPhase } from '@dltech/atlas-wire'

export const displayPhaseOf = (phase: ERotationPhase): EWireRotationPhase | null => {
  switch (phase) {
    case ERotationPhase.Settling:
      return EWireRotationPhase.Settling
    case ERotationPhase.Summarising:
    case ERotationPhase.Preparing:
      return EWireRotationPhase.Preparing
    case ERotationPhase.Committing:
      return EWireRotationPhase.Writing
    case ERotationPhase.Activating:
      return EWireRotationPhase.Activating
    case ERotationPhase.Failed:
    case ERotationPhase.Aborted:
      return EWireRotationPhase.Failed
    case ERotationPhase.Idle:
    case ERotationPhase.Committed:
      return null
  }
}

export const stagePhaseOfWire = (phase: EWireRotationPhase): ERotationPhase => {
  switch (phase) {
    case EWireRotationPhase.Settling:
      return ERotationPhase.Settling
    case EWireRotationPhase.Preparing:
      return ERotationPhase.Preparing
    case EWireRotationPhase.Writing:
      return ERotationPhase.Committing
    case EWireRotationPhase.Activating:
      return ERotationPhase.Activating
    case EWireRotationPhase.Failed:
      return ERotationPhase.Failed
  }
}
