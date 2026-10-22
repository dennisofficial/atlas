import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@dltech/atlas-ui/components/drawer'

const meta = {
  title: 'Components/Drawer',
  component: Drawer,
  argTypes: {
    swipeDirection: { control: 'inline-radio', options: ['down', 'up', 'left', 'right'] },
  },
  args: { swipeDirection: 'down' },
} satisfies Meta<typeof Drawer>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Drawer {...args}>
      <DrawerTrigger render={<Button variant="outline" />}>Review changes</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>3 files changed</DrawerTitle>
          <DrawerDescription>
            Review the edits before they are committed to the session branch.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button>Commit</Button>
          <DrawerClose render={<Button variant="outline" />}>Cancel</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
}

export const WithSwipeHandle: Story = {
  render: (args) => (
    <Drawer showSwipeHandle {...args}>
      <DrawerTrigger render={<Button variant="outline" />}>Open tray</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Session tray</DrawerTitle>
          <DrawerDescription>Swipe down to dismiss.</DrawerDescription>
        </DrawerHeader>
      </DrawerContent>
    </Drawer>
  ),
}
