import type { BootView } from '@dltech/atlas-client/session'
import { EBootStepState } from '@dltech/atlas-ui/sandbox-boot-copy'
import { radius, space } from '@dltech/atlas-ui/tokens'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  EFontFamily,
  ETextRole,
  ETraceStatus,
  Icon,
  Step,
  Text,
  Trace,
  TraceLine,
  useTheme,
  withAlpha,
  Spinner,
} from '@dltech/atlas-ui-native'
import { Circle, CircleCheck, CircleX } from 'lucide-react-native'
import { useMemo } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'

import { bootDisplayOf, type BootChildDisplay, type BootStepDisplay } from '../session/boot-display'

const CODE_MAX_HEIGHT = 200

const TRACE_STATUS: Record<EBootStepState, ETraceStatus | undefined> = {
  [EBootStepState.Pending]: ETraceStatus.Pending,
  [EBootStepState.Running]: ETraceStatus.Running,
  [EBootStepState.Done]: undefined,
  [EBootStepState.Error]: ETraceStatus.Error,
  [EBootStepState.Interrupted]: ETraceStatus.Running,
}

const errorOf = (step: { state: EBootStepState; detail?: string }): string | undefined =>
  step.state === EBootStepState.Error ? step.detail : undefined

const StepMark = ({ state }: { state: EBootStepState }) => {
  const theme = useTheme()
  if (state === EBootStepState.Running || state === EBootStepState.Interrupted) {
    return <Spinner color={theme.mutedForeground} />
  }
  if (state === EBootStepState.Error) return <Icon icon={CircleX} color={theme.destructive} />
  if (state === EBootStepState.Done)
    return <Icon icon={CircleCheck} color={theme.mutedForeground} />
  return <Icon icon={Circle} color={theme.mutedForeground} />
}

const MonoBlock = ({ text, background }: { text: string; background: string }) => (
  <ScrollView
    nestedScrollEnabled
    style={[styles.code, { backgroundColor: background }]}
    contentContainerStyle={styles.codeContent}
  >
    <Text size={ETextRole.Xs} family={EFontFamily.Mono} leading={1.625} selectable>
      {text}
    </Text>
  </ScrollView>
)

const ErrorBlock = ({ text }: { text: string }) => {
  const theme = useTheme()
  return <MonoBlock text={text} background={withAlpha({ color: theme.destructive, alpha: 0.1 })} />
}

const ChildLine = ({ child }: { child: BootChildDisplay }) => {
  const error = errorOf(child)
  return (
    <View style={styles.step}>
      <TraceLine
        icon={<StepMark state={child.state} />}
        title={child.label}
        description={error === undefined ? child.detail : undefined}
        status={TRACE_STATUS[child.state]}
      />
      {error === undefined ? null : <ErrorBlock text={error} />}
    </View>
  )
}

const terminalOf = (step: BootStepDisplay): string | undefined => {
  if (step.command === undefined) return undefined
  return step.output === undefined || step.output === ''
    ? `$ ${step.command}`
    : `$ ${step.command}\n${step.output}`
}

const StepItem = ({ step }: { step: BootStepDisplay }) => {
  const theme = useTheme()
  const error = errorOf(step)
  const children = step.children ?? []
  const terminal = terminalOf(step)
  return (
    <View style={styles.step}>
      <TraceLine
        icon={<StepMark state={step.state} />}
        title={step.label}
        description={error === undefined ? step.detail : undefined}
        status={TRACE_STATUS[step.state]}
      />
      {error === undefined ? null : <ErrorBlock text={error} />}
      {children.length === 0 ? null : (
        <View style={styles.children}>
          {children.map((child) => (
            <ChildLine key={child.id} child={child} />
          ))}
        </View>
      )}
      {terminal === undefined ? null : <MonoBlock text={terminal} background={theme.muted} />}
    </View>
  )
}

export const BootRowView = ({
  view,
  now,
  onRetry,
}: {
  view: BootView
  now: number
  onRetry: () => void
}) => {
  const display = useMemo(() => bootDisplayOf({ view, now }), [view, now])
  return (
    <Trace>
      <Step
        icon={<StepMark state={display.state} />}
        title={display.title}
        description={display.summary}
        status={TRACE_STATUS[display.state]}
        autoOpen={display.open}
      >
        {display.headerError === undefined ? null : <ErrorBlock text={display.headerError} />}
        {display.steps.map((step) => (
          <StepItem key={step.id} step={step} />
        ))}
        {display.failed ? (
          <View style={styles.retry}>
            <Button
              label="Retry"
              size={EButtonSize.Sm}
              variant={EButtonVariant.Outline}
              onPress={onRetry}
            />
          </View>
        ) : null}
      </Step>
    </Trace>
  )
}

const styles = StyleSheet.create({
  children: {
    gap: space(1.5),
    paddingLeft: space(4),
  },
  code: {
    borderRadius: radius(0.8),
    maxHeight: CODE_MAX_HEIGHT,
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
  codeContent: {
    flexGrow: 0,
  },
  retry: {
    flexDirection: 'row',
  },
  step: {
    gap: space(1),
  },
})
