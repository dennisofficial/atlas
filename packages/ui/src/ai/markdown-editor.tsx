/// <reference path="./internal/css-modules.d.ts" />
'use client'

import '@mdxeditor/editor/style.css'
import '../styles/markdown-editor.css'

import { useEffect, useMemo, useRef } from 'react'
import {
  diffSourcePlugin,
  linkDialogPlugin,
  markdownShortcutPlugin,
  MDXEditor,
  type MDXEditorMethods,
  toolbarPlugin,
  type ViewMode,
} from '@mdxeditor/editor'

import { cn } from '#lib/utils'
import { EditorFieldContext, markdownEditorBridge } from './internal/markdown-editor-bridge'
import { createTranslation, MARKDOWN_EXPORT_OPTIONS } from './internal/markdown-editor-config'
import { createDocumentPlugins } from './internal/markdown-editor-document'
import { ATLAS_CODEMIRROR_EXTENSIONS } from './internal/markdown-editor-highlight'
import { iconComponentFor } from './internal/markdown-editor-icons'
import { EMarkdownEditorVariant } from './internal/markdown-editor-variant'
import { MarkdownEditorToolbar } from './internal/markdown-editor-toolbar'

export { EMarkdownEditorVariant }

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  maxLength?: number
  readOnly?: boolean
  placeholder?: string
  id?: string
  ariaLabel?: string
  ariaInvalid?: boolean
  defaultSourceMode?: boolean
  variant?: EMarkdownEditorVariant
  className?: string
}

const FIELD_FRAME_CLASS =
  'relative flex h-64 min-h-32 w-full resize-y flex-col overflow-hidden rounded-lg border border-input bg-transparent text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-[invalid=true]:border-destructive data-[invalid=true]:ring-3 data-[invalid=true]:ring-destructive/20 dark:bg-input/30 dark:data-[invalid=true]:border-destructive/50 dark:data-[invalid=true]:ring-destructive/40'

const DOCUMENT_FRAME_CLASS = 'relative flex w-full flex-col'

const VARIANT_CLASSES: Record<
  EMarkdownEditorVariant,
  { frame: string; editor: string; content: string }
> = {
  [EMarkdownEditorVariant.Field]: {
    frame: FIELD_FRAME_CLASS,
    editor: 'atlas-markdown-editor mdxeditor-full-height',
    content: 'atlas-markdown-content',
  },
  [EMarkdownEditorVariant.Document]: {
    frame: DOCUMENT_FRAME_CLASS,
    editor: 'atlas-markdown-editor',
    content: 'atlas-markdown-content atlas-markdown-document',
  },
}

export function MarkdownEditor({
  value,
  onChange,
  maxLength,
  readOnly = false,
  placeholder,
  id,
  ariaLabel,
  ariaInvalid = false,
  defaultSourceMode = false,
  variant = EMarkdownEditorVariant.Field,
  className,
}: MarkdownEditorProps) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const emittedRef = useRef(value)
  const viewModeRef = useRef<ViewMode>(defaultSourceMode ? 'source' : 'rich-text')
  const invalid = ariaInvalid || (maxLength !== undefined && value.length > maxLength)

  const plugins = useMemo(
    () => [
      ...createDocumentPlugins(),
      linkDialogPlugin(),
      markdownShortcutPlugin(),
      diffSourcePlugin({
        viewMode: defaultSourceMode ? 'source' : 'rich-text',
        codeMirrorExtensions: ATLAS_CODEMIRROR_EXTENSIONS,
      }),
      ...(readOnly ? [] : [toolbarPlugin({ toolbarContents: () => <MarkdownEditorToolbar /> })]),
      markdownEditorBridge({ viewModeRef }),
    ],
    [readOnly, defaultSourceMode],
  )
  const translation = useMemo(() => createTranslation({ ariaLabel }), [ariaLabel])
  const fieldState = useMemo(() => ({ id, invalid, variant }), [id, invalid, variant])
  const classes = VARIANT_CLASSES[variant]

  useEffect(() => {
    if (value === emittedRef.current) return
    emittedRef.current = value
    editorRef.current?.setMarkdown(value)
  }, [value])

  const handleChange = (markdown: string, isInitialNormalize: boolean) => {
    if (isInitialNormalize) return
    const keepsTrailingNewline =
      viewModeRef.current === 'rich-text' && value.endsWith('\n') && !markdown.endsWith('\n')
    const next = keepsTrailingNewline ? `${markdown}\n` : markdown
    emittedRef.current = next
    onChange(next)
  }

  return (
    <div
      data-slot="markdown-editor"
      data-invalid={invalid}
      data-readonly={readOnly}
      data-variant={variant}
      className={cn(classes.frame, className)}
    >
      <EditorFieldContext.Provider value={fieldState}>
        <MDXEditor
          key={readOnly ? 'read-only' : 'editable'}
          ref={editorRef}
          markdown={value}
          onChange={handleChange}
          readOnly={readOnly}
          placeholder={placeholder}
          plugins={plugins}
          toMarkdownOptions={MARKDOWN_EXPORT_OPTIONS}
          iconComponentFor={iconComponentFor}
          translation={translation}
          spellCheck={false}
          className={classes.editor}
          contentEditableClassName={classes.content}
        />
      </EditorFieldContext.Provider>
    </div>
  )
}
