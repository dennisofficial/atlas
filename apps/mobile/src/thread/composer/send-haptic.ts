import { ImpactFeedbackStyle, impactAsync } from 'expo-haptics'

export const playPressHaptic = () => {
  void impactAsync(ImpactFeedbackStyle.Light)
}
