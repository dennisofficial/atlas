import {
  EProviderSignInState,
  type ProviderSignInControl,
  type ProviderSignInFlow,
} from '@dltech/atlas-client/settings'
import { ETextRole, Input, Text } from '@dltech/atlas-ui-native'
import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ActionRow, Row, Section } from '../settings-parts'
import { openProviderBrowser } from './use-provider-sign-in'

function PasteCodeFields({
  flow,
  control,
}: {
  flow: Extract<ProviderSignInFlow, { authorizeUrl: string }>
  control: ProviderSignInControl
}) {
  const [code, setCode] = useState('')
  return (
    <>
      <Text size={ETextRole.Sm}>
        Finish sign-in in the browser, then paste the authorization code here.
      </Text>
      <ActionRow label="Open sign-in page" onPress={() => openProviderBrowser(flow.authorizeUrl)} />
      <Input
        accessibilityLabel="Authorization code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="none"
        autoCorrect={false}
        editable={flow.status !== EProviderSignInState.Submitting}
      />
      {code.trim() === '' ? null : (
        <ActionRow
          label="Complete sign-in"
          loading={flow.status === EProviderSignInState.Submitting}
          onPress={() => control.submitCode(code)}
        />
      )}
    </>
  )
}

export function ProviderSignInPanel({ control }: { control: ProviderSignInControl }) {
  const flow = control.flow
  if (flow.status === EProviderSignInState.Idle) return null
  return (
    <Section title="Plan sign-in">
      {flow.status === EProviderSignInState.Starting ? (
        <ActionRow label="Starting sign-in…" loading onPress={() => undefined} />
      ) : null}
      {flow.status === EProviderSignInState.Failed ? (
        <>
          <Text size={ETextRole.Sm}>{flow.message}</Text>
          <ActionRow label="Try again" onPress={control.start} />
        </>
      ) : null}
      {flow.status === EProviderSignInState.AwaitingCode ||
      flow.status === EProviderSignInState.Submitting ? (
        <PasteCodeFields key={flow.authorizeUrl} flow={flow} control={control} />
      ) : null}
      {flow.status === EProviderSignInState.Waiting ? (
        <>
          <Row label="Device code" value={flow.userCode} mono />
          <ActionRow
            label="Copy device code"
            onPress={() => {
              void Clipboard.setStringAsync(flow.userCode)
            }}
          />
          <ActionRow
            label="Open ChatGPT"
            onPress={() => openProviderBrowser(flow.verificationUrl)}
          />
          <Text size={ETextRole.Sm}>Enter this code in the browser. Waiting for approval…</Text>
        </>
      ) : null}
      <ActionRow label="Cancel sign-in" onPress={control.cancel} />
    </Section>
  )
}
