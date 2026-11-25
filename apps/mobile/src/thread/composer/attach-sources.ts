export enum EAttachSource {
  Camera = 'camera',
  Library = 'library',
  File = 'file',
}

export type AttachSourceOption = { source: EAttachSource; label: string }

export const ATTACH_SOURCES: readonly AttachSourceOption[] = [
  { source: EAttachSource.Camera, label: 'Take Photo' },
  { source: EAttachSource.Library, label: 'Photo Library' },
  { source: EAttachSource.File, label: 'Choose File' },
]

export const CAMERA_DENIED = 'Allow camera access in Settings to take a photo'
export const PICK_FAILED = "Couldn't open the picker"

export type AttachButtonProps = {
  onPick: (source: EAttachSource) => void
  open: boolean
  onToggle: () => void
}
