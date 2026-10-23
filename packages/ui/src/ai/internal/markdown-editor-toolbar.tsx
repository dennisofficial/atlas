import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  ListsToggle,
  Separator,
  UndoRedo,
} from '@mdxeditor/editor'

const VIEW_MODES = ['rich-text', 'source'] satisfies ('rich-text' | 'source')[]

export function MarkdownEditorToolbar() {
  return (
    <DiffSourceToggleWrapper options={VIEW_MODES}>
      <UndoRedo />
      <Separator />
      <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
      <CodeToggle />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <ListsToggle options={['bullet', 'number']} />
      <CreateLink />
    </DiffSourceToggleWrapper>
  )
}
