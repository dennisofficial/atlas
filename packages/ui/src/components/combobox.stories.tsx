import type { Meta, StoryObj } from '@storybook/react'

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '#components/combobox'

const meta = {
  title: 'Components/Combobox',
  component: Combobox,
} satisfies Meta<typeof Combobox>

export default meta

type Story = StoryObj<typeof meta>

const models = ['claude-opus', 'claude-sonnet', 'gpt-5', 'gpt-5-mini', 'gemini-pro', 'qwen3-coder']

export const Default: Story = {
  render: () => (
    <Combobox items={models}>
      <ComboboxInput placeholder="Select a model" className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No models found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
}

export const Clearable: Story = {
  render: () => (
    <Combobox items={models} defaultValue="gpt-5">
      <ComboboxInput placeholder="Select a model" showClear className="w-64" />
      <ComboboxContent>
        <ComboboxEmpty>No models found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
}

function MultipleCombobox() {
  const anchor = useComboboxAnchor()
  return (
    <Combobox multiple items={models} defaultValue={['claude-opus', 'gpt-5']}>
      <ComboboxChips ref={anchor} className="w-80">
        <ComboboxValue>
          {(values: string[]) => (
            <>
              {values.map((value) => (
                <ComboboxChip key={value}>{value}</ComboboxChip>
              ))}
              <ComboboxChipsInput placeholder="Add model" />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No models found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export const Multiple: Story = { render: () => <MultipleCombobox /> }

export const Disabled: Story = {
  render: () => (
    <Combobox items={models} disabled>
      <ComboboxInput placeholder="Select a model" className="w-64" />
    </Combobox>
  ),
}
