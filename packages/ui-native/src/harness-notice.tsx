import { radius, space } from '@dltech/atlas-ui/tokens'
import { Bell, CircleAlert, CircleCheck, CircleX } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { Text } from './text'
import { EFontFamily, ETextRole, ETextTone, RELAXED_LEADING } from './text-style'
import { ETraceStatus, Step, Trace } from './trace'
import { useTheme } from './use-theme'

export enum EHarnessNoticeTone {
  Ok = 'ok',
  Failed = 'failed',
  Attention = 'attention',
  Quiet = 'quiet',
}

export const HarnessNotice = ({
  title,
  tone,
  body,
  emptyNote,
}: {
  title: string
  tone: EHarnessNoticeTone
  body?: string | undefined
  emptyNote?: string | undefined
}) => {
  const theme = useTheme()
  const hasBody = body !== undefined && body.trim().length > 0
  const color =
    tone === EHarnessNoticeTone.Failed
      ? theme.destructive
      : tone === EHarnessNoticeTone.Attention
        ? theme.warning
        : theme.mutedForeground
  const Icon = (() => {
    if (tone === EHarnessNoticeTone.Failed) return CircleX
    if (tone === EHarnessNoticeTone.Attention) return CircleAlert
    if (tone === EHarnessNoticeTone.Ok) return CircleCheck
    return Bell
  })()
  return (
    <Trace>
      <Step
        icon={<Icon size={16} color={color} />}
        title={title}
        status={tone === EHarnessNoticeTone.Failed ? ETraceStatus.Error : undefined}
        {...(hasBody ? {} : emptyNote === undefined ? {} : { description: emptyNote })}
      >
        {hasBody ? (
          <View style={[styles.mono, { backgroundColor: theme.muted }]}>
            <Text
              size={ETextRole.Xs}
              family={EFontFamily.Mono}
              leading={RELAXED_LEADING}
              selectable
            >
              {body}
            </Text>
          </View>
        ) : undefined}
      </Step>
    </Trace>
  )
}

const styles = StyleSheet.create({
  mono: {
    borderRadius: radius(0.8),
    padding: space(2),
  },
})
