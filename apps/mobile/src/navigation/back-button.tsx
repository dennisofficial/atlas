import { Button, EButtonSize, EButtonVariant } from '@dltech/atlas-ui-native'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'

export const BackButton = () => (
  <Button
    label="Back"
    icon={ChevronLeft}
    variant={EButtonVariant.Ghost}
    size={EButtonSize.IconLg}
    onPress={() => router.back()}
  />
)
