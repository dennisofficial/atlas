import { inlineData, isImage, type Attachment } from '@dltech/atlas-core'
import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import { MarkdownView } from '../../markdown/markdown-view'
import { defaultOpenImage, type OpenImage } from '../../open-image'
import { saidImageText } from '../../said-images'
import { glyph, theme, TRANSCRIPT_INSET } from '../../theme'
import { Panel, PANEL_INSET, PANEL_PAD } from '../panel'

const RESERVED = PANEL_INSET + PANEL_PAD + TRANSCRIPT_INSET

const NARROWEST_BAND = 20

const TAKE_BACK = '↑ to edit'

const SENDING = 'sending…'

const SEND_FAILED = "didn't send"

const basename = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

type AttachmentChip = {
  key: string
  icon: string
  label: string
  attachment?: Attachment
}

function attachmentChips(args: {
  skills: readonly string[]
  files: readonly string[]
  attachments: readonly Attachment[]
}): readonly AttachmentChip[] {
  return [
    ...args.skills.map((skill) => ({
      key: `skill:${skill}`,
      icon: glyph.skill,
      label: skill,
    })),
    ...args.files.map((file) => ({
      key: `file:${file}`,
      icon: glyph.file,
      label: basename(file),
    })),
    ...args.attachments.map((attachment) => ({
      key: `attachment:${attachment.id}`,
      icon: isImage(attachment) ? glyph.image : glyph.file,
      label: isImage(attachment) ? saidImageText(attachment) : attachment.name,
      attachment,
    })),
  ]
}

function Chip(props: { chip: AttachmentChip; onOpenImage: OpenImage }): React.ReactNode {
  const { attachment } = props.chip
  const data = attachment === undefined ? undefined : inlineData(attachment)
  const handleOpen = (): void => {
    if (attachment !== undefined && data !== undefined)
      props.onOpenImage({
        path: attachment.name,
        mediaType: attachment.mediaType,
        data,
      })
  }
  const region = useClickRegion(data === undefined ? undefined : handleOpen)
  return (
    <box
      backgroundColor={region.hovered ? theme.hoverBg : theme.selectedBg}
      flexShrink={0}
      {...region.handlers}
    >
      <text fg={theme.body}>{` ${props.chip.icon} ${props.chip.label} `}</text>
    </box>
  )
}

/**
 * What the message carried rides inside the slab: a footer band seamed onto a darker ground, each
 * attachment a raised chip so a skill, a file and an image read as the same kind of thing.
 */
export function UserBlock(props: {
  said: readonly string[]
  width: number
  takeBack?: boolean
  sending?: boolean
  sendFailed?: boolean
  skills?: readonly string[]
  files?: readonly string[]
  attachments?: readonly Attachment[]
  onOpenImage?: OpenImage
}): React.ReactNode {
  const columns = Math.max(NARROWEST_BAND, props.width - RESERVED)
  const chips = attachmentChips({
    skills: props.skills ?? [],
    files: props.files ?? [],
    attachments: props.attachments ?? [],
  })

  return (
    <box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Panel
        rail={theme.court.yours}
        fill={theme.userBg}
        band={theme.userBand}
        width={props.width - TRANSCRIPT_INSET}
        {...(props.sendFailed === true
          ? {
              badge: <text fg={theme.error} bg={theme.userBg}>{` ${SEND_FAILED} `}</text>,
            }
          : props.sending === true
            ? {
                badge: <text fg={theme.hint} bg={theme.userBg}>{` ${SENDING} `}</text>,
              }
            : props.takeBack === true
              ? {
                  badge: <text fg={theme.hint} bg={theme.userBg}>{` ${TAKE_BACK} `}</text>,
                }
              : {})}
        {...(chips.length === 0
          ? {}
          : {
              footer: (
                <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
                  {chips.map((chip) => (
                    <Chip
                      key={chip.key}
                      chip={chip}
                      onOpenImage={props.onOpenImage ?? defaultOpenImage}
                    />
                  ))}
                </box>
              ),
            })}
      >
        {props.said.map((text, index) => (
          <MarkdownView
            key={`${index}:${text}`}
            source={text}
            width={columns}
            fg={theme.userFg}
            bg={theme.userBg}
          />
        ))}
      </Panel>
    </box>
  )
}
