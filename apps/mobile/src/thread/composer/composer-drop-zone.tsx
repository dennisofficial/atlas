import { useTheme } from '@dltech/atlas-ui-native'
import { type Assets, DragDropContentView } from 'expo-drag-drop-content-view'
import { type ReactNode, useState } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

import type { PickedFile } from './attachment-plan'
import { droppedFilesOf } from './dropped-files'

export const ComposerDropZone = ({
  style,
  borderColor,
  onFiles,
  children,
}: {
  style: StyleProp<ViewStyle>
  borderColor: string
  onFiles: ((files: PickedFile[]) => void) | undefined
  children: ReactNode
}) => {
  const theme = useTheme()
  const [hovering, setHovering] = useState(false)

  const handleDrop = ({ assets }: Assets) => {
    setHovering(false)
    if (onFiles === undefined) return
    const files = droppedFilesOf({ assets, at: Date.now() })
    if (files.length > 0) onFiles(files)
  }

  return (
    <DragDropContentView
      style={[
        style,
        { borderColor: hovering && onFiles !== undefined ? theme.primary : borderColor },
      ]}
      onEnter={() => setHovering(true)}
      onExit={() => setHovering(false)}
      onDragEnd={() => setHovering(false)}
      onDrop={handleDrop}
    >
      {children}
    </DragDropContentView>
  )
}
