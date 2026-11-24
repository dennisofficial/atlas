import { refKey, type SettingDefinition, type SettingValue } from '@dltech/atlas-core'
import type { SessionModelChoice } from '@dltech/atlas-protocol'
import { useCallback, useMemo, useRef } from 'react'

import type { SwitcherChoice } from '../ui/switcher-model'
import { EScreen, type ScreenState } from './app-screen'
import { modelOfRef, modelPickOf, problemOf } from './app-next-support'
import { definitionOfSetting } from './settings-values'
import type { SessionApi } from './session-api'
import type { SessionModels } from './use-session-models'
import { useModelChoice, type ModelChoiceControl } from './use-model-choice'

export type AppModelPick = {
  choice: ModelChoiceControl
  canPickModel: boolean
  currentModel: SessionModelChoice | null
  chooseSetting: (id: string) => void
}

export const initialModelOf = (ref: string | null): SessionModelChoice | null =>
  ref === null ? null : modelOfRef(ref)

export function useAppModelPick(args: {
  models: SessionModels
  screen: ScreenState
  initialModel: SessionModelChoice | null
  api: () => SessionApi | null
  onScreen: (next: ScreenState) => void
  writeSetting: (written: { definition: SettingDefinition; value: SettingValue }) => void
}): AppModelPick {
  const { models, screen, initialModel } = args
  const settingTarget = useRef<string | null>(null)
  const api = useRef(args.api)
  api.current = args.api
  const onScreen = useRef(args.onScreen)
  onScreen.current = args.onScreen
  const writeSetting = useRef(args.writeSetting)
  writeSetting.current = args.writeSetting

  const canPickModel = screen.screen === EScreen.Transcript || screen.screen === EScreen.NewSession
  const currentModel = canPickModel ? screen.model : initialModel

  const handlePick = useCallback(
    (picked: SwitcherChoice) => {
      const target = settingTarget.current
      if (target !== null) {
        settingTarget.current = null
        const definition = definitionOfSetting(target)
        if (definition !== undefined && picked.ref !== null)
          writeSetting.current({ definition, value: refKey(picked.ref) })
        return
      }

      const next = modelPickOf({
        screen,
        picked,
        api: api.current(),
        onProblem: problemOf,
      })
      if (next !== null) onScreen.current(next)
    },
    [screen],
  )

  const choice = useModelChoice({
    catalogue: models.providers,
    reachable: models.reachable,
    active: currentModel,
    onPick: handlePick,
  })

  const chooseSetting = useCallback(
    (id: string) => {
      settingTarget.current = id
      choice.handleOpen()
    },
    [choice],
  )

  return useMemo(
    () => ({ choice, canPickModel, currentModel, chooseSetting }),
    [canPickModel, choice, chooseSetting, currentModel],
  )
}
