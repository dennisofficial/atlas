import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge";
import { EmptyState } from "./empty-state";
import {
  Table,
  type TableColumn,
  type TableProps,
  type TableRow,
} from "./table";

const columns: TableColumn<TableRow>[] = [
  { key: "name", header: "Session" },
  { key: "status", header: "State", width: 110 },
  { key: "model", header: "Model", mono: true, muted: true, width: 160 },
  { key: "spend", header: "Spend", mono: true, align: "right", width: 80 },
];

const rows: TableRow[] = [
  {
    id: "t1",
    name: "fix telemetry schema",
    status: "running",
    model: "claude-sonnet-4-6",
    spend: "$4.18",
  },
  {
    id: "t2",
    name: "port spinner atoms",
    status: "awaiting",
    model: "claude-sonnet-4-6",
    spend: "$1.02",
  },
  {
    id: "t3",
    name: "bench load profile",
    status: "passed",
    model: "gpt-5.3-codex",
    spend: "$0.64",
  },
];

const statusColumn: TableColumn<TableRow> = {
  key: "status",
  header: "State",
  width: 110,
  render: (row) => {
    const value = String(row.status ?? "");
    const tone =
      value === "running"
        ? "primary"
        : value === "awaiting"
          ? "warning"
          : "success";
    return (
      <Badge tone={tone} variant="bare" dot>
        {value}
      </Badge>
    );
  },
};

const meta = {
  title: "Display/Table",
  component: Table,
  tags: ["autodocs"],
  argTypes: {
    density: {
      control: "select",
      options: ["dense", "default", "comfortable"],
    },
  },
  args: { columns, rows },
} satisfies Meta<TableProps<TableRow>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithRender: Story = {
  args: { columns: [columns[0]!, statusColumn, columns[2]!, columns[3]!] },
};

export const Dense: Story = {
  args: { density: "dense" },
};

export const Comfortable: Story = {
  args: { density: "comfortable" },
};

export const Zebra: Story = {
  args: { zebra: true },
};

export const Selected: Story = {
  args: { selectedId: "t2", onRowClick: () => {} },
};

export const Empty: Story = {
  args: {
    rows: [],
    empty: (
      <EmptyState
        compact
        title="No sessions"
        body="Start one from the sidebar."
      />
    ),
  },
};
