import React from 'react'

import {
  EQualityNoticeTone,
  qualityNoticeLine,
  type QualityNotice,
} from '@dltech/atlas-client/transcript'

import { glyph, theme } from '../../theme'

export function qualityNoticeText(notice: QualityNotice): { text: string; fg: string } {
  const line = qualityNoticeLine(notice)
  if (line.tone === EQualityNoticeTone.Warning) {
    return { text: ` ${glyph.warning} ${line.label}`, fg: theme.warn }
  }
  return { text: ` ${glyph.failed} ${line.label}`, fg: theme.error }
}

export function QualityIndicator(props: { notice: QualityNotice }): React.ReactNode {
  const { text, fg } = qualityNoticeText(props.notice)
  return <span fg={fg}>{text}</span>
}
