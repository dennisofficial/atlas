import React from 'react'

import { mixHex } from '../colour'
import { logoCells, logoRows, logoSpans, type LogoSweep } from '../logo'
import type { ELogo } from '../logo-store'
import { glyph, theme } from '../theme'
import { Spans } from './spans'

const NARROW_LABEL = 'atlas'

export function NarrowLogo(props: { drain?: number }): React.ReactNode {
  const drain = props.drain ?? 0
  const faded = (colour: string): string => mixHex({ from: colour, to: theme.appBg, amount: drain })

  return (
    <text>
      <span fg={faded(theme.accent)}>{`${glyph.block} `}</span>
      <span fg={faded(theme.hover)}>{NARROW_LABEL}</span>
    </text>
  )
}

export function LogoRows(props: { logo: ELogo; sweep?: LogoSweep }): React.ReactNode {
  const rows = logoSpans({
    logo: props.logo,
    accent: theme.accent,
    ground: theme.appBg,
    bright: theme.bright,
    ...(props.sweep === undefined ? {} : { sweep: props.sweep }),
  })

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      height={logoRows(props.logo)}
      width={logoCells(props.logo)}
    >
      {rows.map((row, index) => (
        <box key={index} height={1} flexShrink={0}>
          <text>
            <Spans spans={row} />
          </text>
        </box>
      ))}
    </box>
  )
}
