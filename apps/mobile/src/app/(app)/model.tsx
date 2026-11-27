import { router } from 'expo-router'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'

import { ModelListBody } from '../../composer/model-picker'
import { useModelSheetRequest } from '../../composer/model-sheet-request'
import { usePinnedModels } from '../../composer/use-pinned-models'

const handleClose = () => router.back()

const ModelSheetBody = () => {
  const request = useModelSheetRequest()
  const { pinned, setPinned } = usePinnedModels()
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (request === null) handleClose()
  }, [request])

  if (request === null) return null
  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
      <ModelListBody
        models={request.models}
        selection={request.selection}
        pinned={pinned}
        personalId={request.personalId}
        defaultRow={request.defaultRow}
        onPinnedChange={setPinned}
        onSelect={request.onSelect}
        onClose={handleClose}
      />
    </View>
  )
}

export default function ModelSheetScreen() {
  return (
    <SafeAreaProvider>
      <ModelSheetBody />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingTop: 12,
  },
})
