import React from 'react'

import type { SessionModelChoice } from '@dltech/atlas-protocol'

import type { ProjectPromptControl } from '../ui/hooks/use-project-prompt'
import { ProjectPrompt } from '../ui/components/project-prompt'
import { Spans, type Span } from '../ui/components/spans'
import { theme } from '../ui/theme'
import { ComposerPane } from './composer-pane'
import type { SessionAttachments } from './use-session-attachments'
import type { SessionComposer } from './use-session-composer'

const SENTENCE = 'The first message creates the session in the project this clone belongs to.'

const headerSpans = (args: {
  cwd: string
  model: SessionModelChoice | null
  choosingModel: boolean
}): readonly Span[] => [
  { text: 'new session', fg: theme.body },
  { text: ` · ${args.cwd}`, fg: theme.hint },
  ...(args.model === null
    ? [{ text: ' · first reachable model', fg: theme.hint }]
    : [{ text: ` · ${args.model.ref}`, fg: theme.hint }]),
  ...(args.choosingModel ? [{ text: ' · choosing…', fg: theme.meta }] : []),
]

export function NewSessionScreen(props: {
  cwd: string
  model: SessionModelChoice | null
  choosingModel: boolean
  composer: SessionComposer
  attachments: SessionAttachments
  prompt: ProjectPromptControl
  width: number
  height: number
  notice: React.ReactNode
}): React.ReactNode {
  return (
    <box flexDirection="column" flexGrow={1} width={props.width}>
      <box flexShrink={0} paddingLeft={2} paddingRight={2}>
        <text>
          <Spans
            spans={headerSpans({
              cwd: props.cwd,
              model: props.model,
              choosingModel: props.choosingModel,
            })}
          />
        </text>
      </box>
      <box flexShrink={0} paddingLeft={2} paddingRight={2}>
        <text>
          <Spans spans={[{ text: SENTENCE, fg: theme.hint }]} />
        </text>
      </box>
      {props.attachments.uploading ? (
        <box flexShrink={0} paddingLeft={2} paddingRight={2}>
          <text>
            <Spans spans={[{ text: 'uploading a picture…', fg: theme.meta }]} />
          </text>
        </box>
      ) : null}
      <box flexGrow={1} />
      {props.prompt.state === null ? null : (
        <ProjectPrompt
          width={props.width}
          state={props.prompt.state}
          onChoose={props.prompt.handlePickRow}
          onFocusField={props.prompt.handleFocusField}
          onCancel={props.prompt.handleCancel}
        />
      )}
      <ComposerPane
        draft={props.composer.draft}
        fileMenu={props.composer.fileMenu}
        highlights={props.composer.highlights}
        width={props.width}
        height={props.height}
        working={false}
        interrupting={false}
        focused={props.prompt.state === null && !props.choosingModel}
        onCursorMoved={props.composer.handleCursorMoved}
      />
      {props.notice}
    </box>
  )
}
