import { Button, EButtonSize, EButtonVariant } from '@dltech/atlas-ui-native'
import { router } from 'expo-router'
import { Plus } from 'lucide-react-native'

export const NewSessionButton = () => (
  <Button
    label="New session"
    icon={Plus}
    variant={EButtonVariant.Ghost}
    size={EButtonSize.IconLg}
    onPress={() => router.push('/new')}
  />
)
