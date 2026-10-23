import type { Meta, StoryObj } from '@storybook/react'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '#components/accordion'

const meta = {
  title: 'Components/Accordion',
  component: Accordion,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Accordion>

export default meta

type Story = StoryObj<typeof meta>

const sections = [
  {
    value: 'context',
    title: 'What context does the model see?',
    body: 'The harness assembles the system prompt, the project instructions, and the recent turns. Tool results are truncated to the configured budget before they are added.',
  },
  {
    value: 'tools',
    title: 'Which tools can a session call?',
    body: 'Read, edit, bash, grep, and any tools contributed by plugins. A hook can deny a call before it runs.',
  },
  {
    value: 'rewind',
    title: 'What happens on rewind?',
    body: 'The session log is truncated to the chosen turn and the file checkpoints taken after it are restored.',
  },
]

export const Default: Story = {
  render: (args) => (
    <Accordion className="w-[28rem]" defaultValue={['context']} {...args}>
      {sections.map((section) => (
        <AccordionItem key={section.value} value={section.value}>
          <AccordionTrigger>{section.title}</AccordionTrigger>
          <AccordionContent>{section.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}

export const Multiple: Story = {
  render: () => (
    <Accordion className="w-[28rem]" multiple defaultValue={['context', 'tools']}>
      {sections.map((section) => (
        <AccordionItem key={section.value} value={section.value}>
          <AccordionTrigger>{section.title}</AccordionTrigger>
          <AccordionContent>{section.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Accordion className="w-[28rem]">
      <AccordionItem value="open">
        <AccordionTrigger>Available section</AccordionTrigger>
        <AccordionContent>This section can be expanded.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="locked" disabled>
        <AccordionTrigger>Locked section</AccordionTrigger>
        <AccordionContent>Hidden until the session is approved.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
}
