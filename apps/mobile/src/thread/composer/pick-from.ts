import { MAX_MESSAGE_UPLOADS } from '@dltech/atlas-core'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'

import { CAMERA_DENIED, EAttachSource } from './attach-sources'
import type { PickedFile } from './attachment-plan'
import { pickedDocumentOf, pickedMediaOf } from './picked-files'

export type PickOutcome = { files: PickedFile[]; notice: string | null }

const NOTHING: PickOutcome = { files: [], notice: null }

const mediaOf = (result: ImagePicker.ImagePickerResult): PickOutcome => {
  if (result.canceled) return NOTHING
  const at = Date.now()
  return {
    files: result.assets.map((asset, index) => pickedMediaOf({ asset, index, at })),
    notice: null,
  }
}

const takePhoto = async (): Promise<PickOutcome> => {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) return { files: [], notice: CAMERA_DENIED }
  return mediaOf(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }))
}

const chooseMedia = async (): Promise<PickOutcome> => {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) return NOTHING
  return mediaOf(
    await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_MESSAGE_UPLOADS,
      quality: 1,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    }),
  )
}

const chooseFiles = async (): Promise<PickOutcome> => {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  })
  if (result.canceled) return NOTHING
  return { files: result.assets.map(pickedDocumentOf), notice: null }
}

const PICKERS: Record<EAttachSource, () => Promise<PickOutcome>> = {
  [EAttachSource.Camera]: takePhoto,
  [EAttachSource.Library]: chooseMedia,
  [EAttachSource.File]: chooseFiles,
}

export const pickFrom = (source: EAttachSource): Promise<PickOutcome> => PICKERS[source]()
