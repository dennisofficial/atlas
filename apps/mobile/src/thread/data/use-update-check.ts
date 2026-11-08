import { useCallback, useState } from 'react'

import {
  checkForUpdate,
  EUpdateStage,
  restartApp,
  updateCardView,
  type UpdateCardView,
  type UpdatesClient,
} from './update-check'

export type UpdateCheck = UpdateCardView & {
  stage: EUpdateStage
  checking: boolean
  act: () => void
}

export function useUpdateCheck(args: { client: UpdatesClient }): UpdateCheck {
  const [stage, setStage] = useState(EUpdateStage.Idle)

  const act = useCallback(() => {
    if (stage === EUpdateStage.Checking) return
    if (stage === EUpdateStage.Ready) {
      void restartApp({ client: args.client }).then(setStage)
      return
    }
    setStage(EUpdateStage.Checking)
    void checkForUpdate({ client: args.client }).then(setStage)
  }, [stage, args.client])

  return {
    ...updateCardView(stage),
    stage,
    checking: stage === EUpdateStage.Checking,
    act,
  }
}
