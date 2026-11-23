import { contextPercentOf } from '@dltech/atlas-client/session'
import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'

export type ContextMeter = {
  used: number | null
  window: number | null
}

export const ContextReading = ({ context }: { context: ContextMeter | null }) => {
  const percent =
    context === null ? null : contextPercentOf({ used: context.used, window: context.window })
  return (
    <Text
      accessibilityLabel={percent === null ? 'Context not measured yet' : `Context ${percent}%`}
      size={ETextRole.Xs}
      tone={ETextTone.Muted}
    >
      {percent === null ? '—' : `${percent}%`}
    </Text>
  )
}
