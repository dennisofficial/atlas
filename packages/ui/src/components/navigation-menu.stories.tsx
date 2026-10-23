import type { Meta, StoryObj } from '@storybook/react'

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '#components/navigation-menu'

const meta = {
  title: 'Components/Navigation Menu',
  component: NavigationMenu,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof NavigationMenu>

export default meta

type Story = StoryObj<typeof meta>

const guides = [
  { title: 'Sessions', description: 'Start, resume, and rewind agent sessions.' },
  { title: 'Tools', description: 'What the model can call and who approves it.' },
  { title: 'Plugins', description: 'Contribute hooks, tools, and prompt fragments.' },
]

export const Default: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>Guides</NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid w-80 gap-1">
              {guides.map((guide) => (
                <li key={guide.title}>
                  <NavigationMenuLink href="#" className="flex-col items-start gap-0.5">
                    <span className="font-medium">{guide.title}</span>
                    <span className="text-muted-foreground">{guide.description}</span>
                  </NavigationMenuLink>
                </li>
              ))}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#" className={navigationMenuTriggerStyle()}>
            Changelog
          </NavigationMenuLink>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#" className={navigationMenuTriggerStyle()}>
            Docs
          </NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
}
