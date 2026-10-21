import React from 'react'

import { PANEL_BOTTOM_EDGE } from '../borders'
import { mixHex } from '../colour'
import { useAppearance } from '../hooks/use-appearance'
import { logoCells, logoHasNarrowLabel, logoRows } from '../logo'
import { logo, type ELogo } from '../logo-store'
import { collapseHome, tailOfPath } from '../paths'
import { type StartupFrame } from '../startup-model'
import { theme } from '../theme'
import { LogoRows, NarrowLogo } from './logo-rows'
import { Spans } from './spans'

const SEPARATOR = ' · '

const SIDE_AIR = 4

const CURTAIN_Z = 900

const STATUS_AIR = 2

const STATUS_ROWS = STATUS_AIR + 1

const SEAM_FALL = 0.45

const fadedTo = (args: { colour: string; drain: number }): string =>
  mixHex({ from: args.colour, to: theme.appBg, amount: args.drain })

function Seam(props: { width: number; lift: number }): React.ReactNode {
  return (
    <box position="absolute" left={0} right={0} bottom={0} height={1}>
      <text
        fg={theme.appBg}
        bg={fadedTo({ colour: theme.accent, drain: SEAM_FALL + props.lift * (1 - SEAM_FALL) })}
      >
        {PANEL_BOTTOM_EDGE.repeat(props.width)}
      </text>
    </box>
  )
}

function Mark(props: { frame: StartupFrame; roomy: boolean; logo: ELogo }): React.ReactNode {
  const { reveal, drain } = props.frame

  if (!props.roomy) {
    if (!logoHasNarrowLabel(props.logo)) return null

    return (
      <box height={1} flexShrink={0}>
        <NarrowLogo drain={1 - reveal * (1 - drain)} />
      </box>
    )
  }

  return <LogoRows logo={props.logo} sweep={{ reveal, drain }} />
}

export function Startup(props: {
  frame: StartupFrame
  width: number
  height: number
  status: string
  cwd: string
  home: string
}): React.ReactNode {
  useAppearance()
  const chosen = logo()
  const rows = Math.max(0, Math.round(props.height * (1 - props.frame.lift)))
  if (rows === 0) return null

  const roomy =
    props.width >= logoCells(chosen) + SIDE_AIR &&
    props.height >= logoRows(chosen) + STATUS_ROWS + SIDE_AIR
  const drain = Math.min(1, props.frame.drain + props.frame.lift)
  const dim = fadedTo({ colour: theme.hint, drain })
  const rule = fadedTo({ colour: theme.rule, drain })

  const where = tailOfPath({
    path: collapseHome({ cwd: props.cwd, home: props.home }),
    cells: Math.max(
      0,
      props.width - SIDE_AIR - SEPARATOR.length - [...props.status].length,
    ),
  })

  return (
    <box
      position="absolute"
      left={0}
      right={0}
      top={0}
      height={rows}
      zIndex={CURTAIN_Z}
      overflow="hidden"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme.appBg}
    >
      <Mark frame={props.frame} roomy={roomy} logo={chosen} />
      <box height={STATUS_AIR} flexShrink={0} />
      <box height={1} flexShrink={0}>
        <text>
          <Spans
            spans={[
              { text: where, fg: dim },
              { text: SEPARATOR, fg: rule },
              { text: props.status, fg: dim },
            ]}
          />
        </text>
      </box>
      {props.frame.lift > 0 ? <Seam width={props.width} lift={props.frame.lift} /> : null}
    </box>
  )
}
