import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  EMPTY_MEMORY_STORE,
  MEMORY_RS_CRM_STORE_ID,
  MEMORY_STORES,
} from "../../fixtures/settings-memory";
import { MemoryPage } from "./pages/memory";
import { ESettingsPage } from "./settings-nav";
import { renderSettingsPage } from "./settings-pages";
import { SettingsShell } from "./settings-shell";

const meta = {
  title: "Views/Settings/Personal/Memory",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Memory} renderPage={renderSettingsPage} />
  ),
};

export const ReconcileDue: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Memory}
      renderPage={(page) =>
        page === ESettingsPage.Memory ? (
          <MemoryPage initialStoreId={MEMORY_RS_CRM_STORE_ID} />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  ),
};

export const ViewerOpen: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Memory}
      renderPage={(page) =>
        page === ESettingsPage.Memory ? (
          <MemoryPage defaultOpenMemoryId="g1" />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  ),
};

export const Empty: Story = {
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.Memory}
      renderPage={(page) =>
        page === ESettingsPage.Memory ? (
          <MemoryPage
            initialStores={[...MEMORY_STORES, EMPTY_MEMORY_STORE]}
            initialStoreId={EMPTY_MEMORY_STORE.id}
          />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  ),
};
