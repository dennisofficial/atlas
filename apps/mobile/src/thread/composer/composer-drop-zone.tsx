import { useTheme } from '@dltech/atlas-ui-native'
import { type Assets, DragDropContentView } from 'expo-drag-drop-content-view'
import { type ReactNode, useState } from 'react'
import { type StyleProp, View, type ViewStyle } from 'react-native'

import type { PickedFile } from './attachment-plan'
import { droppedFilesOf } from './dropped-files'

// DragDropContentView swallows touches for any child not at its origin on the new architecture
// (https://github.com/expo/expo/issues/28040), so only the text area goes inside it.
export const ComposerDropZone = ({
  style,
  borderColor,
  onFiles,
  children,
  controls,
}: {
  style: StyleProp<ViewStyle>
  borderColor: string
  onFiles: ((files: PickedFile[]) => void) | undefined
  children: ReactNode
  controls: ReactNode
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
    <View
      style={[
        style,
        { borderColor: hovering && onFiles !== undefined ? theme.primary : borderColor },
      ]}
    >
      <DragDropContentView
        onEnter={() => setHovering(true)}
        onExit={() => setHovering(false)}
        onDragEnd={() => setHovering(false)}
        onDrop={handleDrop}
      >
        {children}
      </DragDropContentView>
      {controls}
    </View>
  )
}
