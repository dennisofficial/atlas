import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar } from "../atoms/avatar";
import { Badge } from "../atoms/badge";
import { Button } from "../atoms/button";
import { Card } from "../atoms/card";
import { Input } from "../atoms/input";
import { Table, type TableColumn, type TableRow } from "../atoms/table";

type WorkItemStatus = "running" | "awaiting" | "failed" | "idle";

interface WorkItem extends TableRow {
  id: string;
  title: string;
  status: WorkItemStatus;
  owner: string;
  updated: string;
}

const STATUS_TONE: Record<WorkItemStatus, "primary" | "warning" | "destructive" | "neutral"> = {
  running: "primary",
  awaiting: "warning",
  failed: "destructive",
  idle: "neutral",
};

const FIXTURE_ROWS: WorkItem[] = [
  { id: "AT-101", title: "Migrate atoms to Base UI", status: "running", owner: "Dennis", updated: "2m ago" },
  { id: "AT-102", title: "Split ui into atoms/molecules", status: "running", owner: "Atlas", updated: "14m ago" },
  { id: "AT-103", title: "Fix @source scanning in apps/web", status: "idle", owner: "Dennis", updated: "1h ago" },
  { id: "AT-104", title: "Add Storybook a11y addon", status: "awaiting", owner: "Atlas", updated: "3h ago" },
  { id: "AT-105", title: "Seed Linear OAuth app credentials", status: "failed", owner: "Dennis", updated: "5h ago" },
];

const columns: TableColumn<WorkItem>[] = [
  { key: "id", header: "ID", mono: true, muted: true, width: 80 },
  { key: "title", header: "Title" },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <Badge tone={STATUS_TONE[row.status]} dot>
        {row.status}
      </Badge>
    ),
  },
  { key: "owner", header: "Owner", muted: true },
  { key: "updated", header: "Updated", muted: true, align: "right" },
];

function WorkItemsView() {
  return (
    <div className="flex w-[760px] flex-col gap-6">
      <header className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-lg font-semibold text-foreground">Atlas</span>
          <span className="text-xs text-hint">Factory</span>
        </div>
        <div className="flex items-center gap-3">
          <Avatar name="Dennis Lysenko" size="sm" status="running" />
          <Button variant="outline" size="sm">
            New work item
          </Button>
        </div>
      </header>
      <Card
        title="Work items"
        subtitle="Open threads across the factory"
        badge={
          <Badge tone="primary" variant="soft">
            {FIXTURE_ROWS.length} open
          </Badge>
        }
        actions={<Input placeholder="Filter work items…" />}
        footer={<span>Sorted by most recently updated</span>}
      >
        <Table columns={columns} rows={FIXTURE_ROWS} />
      </Card>
    </div>
  );
}

const meta = {
  title: "Views/WorkItems",
  component: WorkItemsView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof WorkItemsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
