import type { Meta, StoryObj } from "@storybook/react-vite";

import { SessionView } from "./session/session-view";
import { ETerminalConnection } from "./session/sandbox-terminal";
import { ERightTab, ESessionState } from "./session/session-types";

const meta = {
  title: "Views/App/Session",
  component: SessionView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SessionView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Idle: Story = { args: { state: ESessionState.Idle } };

export const ApprovalPending: Story = { args: { state: ESessionState.ApprovalPending } };

export const PanelCollapsed: Story = { args: { initialPanelOpen: false } };

export const TerminalConnected: Story = {
  args: { initialTab: ERightTab.Terminal, initialTerminalConnection: ETerminalConnection.Connected },
};

export const TerminalConnecting: Story = {
  args: { initialTab: ERightTab.Terminal, initialTerminalConnection: ETerminalConnection.Connecting },
};

export const TerminalSandboxPaused: Story = {
  args: { initialTab: ERightTab.Terminal, initialTerminalConnection: ETerminalConnection.Paused },
};

export const TerminalDisconnected: Story = {
  args: { initialTab: ERightTab.Terminal, initialTerminalConnection: ETerminalConnection.Disconnected },
};

export const PreviewTab: Story = { args: { initialTab: ERightTab.Preview, initialPreviewId: "storybook" } };
