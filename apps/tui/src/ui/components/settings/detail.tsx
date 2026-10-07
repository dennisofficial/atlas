import { homedir } from 'node:os'

import { EDefinitionOrigin, ESettingKind, optionOf, type ResolvedSetting } from '@dltech/atlas-core'
import React from 'react'

import { collapseHome, tailOfPath } from '../../paths'
import { provenanceOf } from '../../settings-format'
import {
  definitionOriginName,
  PROJECT_SETTINGS_UNAVAILABLE,
  savesToProject,
} from '../../settings-destination'
import { isOverriddenSetting, type SettingsRow } from '../../settings-model'
import { glyph, theme } from '../../theme'
import { wrapWords } from '../../text-flow'
import { Spans } from '../spans'

const DETAIL_PAD = 2

const SET_BY = 'Set by'

const DEFINED_IN = 'Defined in'

const SAVES_TO = 'Saves to'

const BUILT_IN_SOURCE = 'Built-in'

const agentTypeOf = (setting: ResolvedSetting) =>
  setting.definition.kind === ESettingKind.Model ? setting.definition.agentType : undefined

function sourceOf(setting: ResolvedSetting): string | undefined {
  const agentType = agentTypeOf(setting)
  if (agentType === undefined) return undefined
  if (agentType.origin === EDefinitionOrigin.BuiltIn) return BUILT_IN_SOURCE
  return agentType.definedIn ?? definitionOriginName(agentType.origin)
}

function overriddenWarning(setting: ResolvedSetting): string | undefined {
  const winner = agentTypeOf(setting)?.overriddenBy
  if (winner === undefined) return undefined
  return `Overridden by the ${definitionOriginName(winner)} definition of the same name. It is not used, and its model cannot be set here.`
}

function destinationLines(setting: SettingsRow): string[] | undefined {
  if (agentTypeOf(setting) === undefined || isOverriddenSetting(setting)) return undefined
  const scope = savesToProject(setting) ? 'project settings' : 'global settings'
  if (setting.writeOrigin !== undefined) return [`Saves to ${scope}`, setting.writeOrigin]
  return savesToProject(setting) ? [PROJECT_SETTINGS_UNAVAILABLE] : undefined
}

function noteOf(setting: ResolvedSetting): { label: string; note: string } | undefined {
  const { definition, value } = setting
  if (definition.kind !== ESettingKind.Choice || typeof value !== 'string') return undefined

  const chosen = optionOf({ definition, value })
  if (chosen?.note === undefined) return undefined
  return { label: chosen.label, note: chosen.note }
}

const detailCells = (width: number): number => Math.max(0, width - DETAIL_PAD * 2)

function Heading(props: { label: string }): React.ReactNode {
  return <text fg={theme.meta}>{props.label.toUpperCase()}</text>
}

export function SettingsDetail(props: {
  width: number
  setting: SettingsRow | undefined
  cwd: string
}): React.ReactNode {
  const cells = detailCells(props.width)
  const where = collapseHome({ cwd: props.cwd, home: homedir() })
  const note = props.setting === undefined ? undefined : noteOf(props.setting)
  const source = props.setting === undefined ? undefined : sourceOf(props.setting)
  const warning = props.setting === undefined ? undefined : overriddenWarning(props.setting)
  const destination = props.setting === undefined ? undefined : destinationLines(props.setting)
  const overridden = warning !== undefined

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      width={props.width}
      backgroundColor={theme.panelBg}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={DETAIL_PAD}
      paddingRight={DETAIL_PAD}
    >
      {props.setting === undefined ? null : (
        <box flexDirection="column" flexShrink={0} gap={1}>
          <box flexDirection="column" flexShrink={0}>
            <Heading label={props.setting.definition.label} />
            {wrapWords({ text: props.setting.definition.description, width: cells }).map((line) => (
              <text key={line} fg={theme.meta}>
                {line}
              </text>
            ))}
          </box>
          {note === undefined ? null : (
            <box flexDirection="column" flexShrink={0}>
              <Heading label={note.label} />
              {wrapWords({ text: note.note, width: cells }).map((line) => (
                <text key={line} fg={theme.hint}>
                  {line}
                </text>
              ))}
            </box>
          )}
          {source === undefined ? null : (
            <box flexDirection="column" flexShrink={0}>
              <Heading label={DEFINED_IN} />
              {wrapWords({ text: source, width: cells }).map((line) => (
                <text key={line} fg={theme.hint}>
                  {line}
                </text>
              ))}
            </box>
          )}
          {warning === undefined ? null : (
            <box flexDirection="column" flexShrink={0}>
              {wrapWords({ text: warning, width: cells }).map((line) => (
                <text key={line} fg={theme.warn}>
                  {line}
                </text>
              ))}
            </box>
          )}
          {destination === undefined ? null : (
            <box flexDirection="column" flexShrink={0}>
              <Heading label={SAVES_TO} />
              {destination.flatMap((line) => wrapWords({ text: line, width: cells })).map((line, index) => (
                <text key={`${index}:${line}`} fg={theme.hint}>
                  {line}
                </text>
              ))}
            </box>
          )}
          {overridden ? null : (
            <box flexDirection="column" flexShrink={0}>
              <Heading label={SET_BY} />
              <text fg={theme.hint}>{provenanceOf(props.setting)}</text>
            </box>
          )}
        </box>
      )}
      <box flexGrow={1} flexShrink={1} flexBasis={0} />
      <box flexDirection="column" flexShrink={0}>
        <text fg={theme.dim}>{tailOfPath({ path: where, cells })}</text>
        <text>
          <Spans
            spans={[
              { text: `${glyph.unseen} `, fg: theme.accent },
              { text: 'atlas', fg: theme.hover },
            ]}
          />
        </text>
      </box>
    </box>
  )
}
