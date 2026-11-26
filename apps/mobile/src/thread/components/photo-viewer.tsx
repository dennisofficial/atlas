import { space } from '@dltech/atlas-ui/tokens'
import { withAlpha } from '@dltech/atlas-ui-native'
import { Image } from 'expo-image'
import { X } from 'lucide-react-native'
import { Modal, Pressable, StyleSheet, View } from 'react-native'

export const PhotoViewer = ({ uri, onClose }: { uri: string | undefined; onClose: () => void }) => (
  <Modal visible={uri !== undefined} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.viewer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the photo"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
      />
      {uri === undefined ? null : (
        <Image source={{ uri }} contentFit="contain" style={styles.full} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the photo"
        hitSlop={12}
        onPress={onClose}
        style={styles.close}
      >
        <X size={22} color="#ffffff" />
      </Pressable>
    </View>
  </Modal>
)

const styles = StyleSheet.create({
  viewer: {
    alignItems: 'center',
    backgroundColor: withAlpha({ color: '#000000', alpha: 0.92 }),
    flex: 1,
    justifyContent: 'center',
  },
  full: {
    height: '100%',
    width: '100%',
  },
  close: {
    position: 'absolute',
    right: space(4),
    top: space(12),
  },
})
