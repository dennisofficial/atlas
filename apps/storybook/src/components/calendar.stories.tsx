import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Calendar } from "@dltech/atlas-ui/components/calendar";

type DateRange = { from: Date | undefined; to?: Date | undefined };

const meta = {
  title: "Components/Calendar",
  component: Calendar,
} satisfies Meta<typeof Calendar>;

export default meta;

type Story = StoryObj<typeof meta>;

function SingleCalendar() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 9, 19));
  return (
    <Calendar
      mode="single"
      selected={date}
      onSelect={setDate}
      defaultMonth={date}
      className="rounded-lg border border-border"
    />
  );
}

function RangeCalendar() {
  const [range, setRange] = useState<DateRange | undefined>({
    from: new Date(2026, 9, 12),
    to: new Date(2026, 9, 19),
  });
  return (
    <Calendar
      mode="range"
      numberOfMonths={2}
      selected={range}
      onSelect={setRange}
      defaultMonth={range?.from}
      className="rounded-lg border border-border"
    />
  );
}

export const Single: Story = { render: () => <SingleCalendar /> };

export const Range: Story = { render: () => <RangeCalendar /> };

export const DropdownCaption: Story = {
  render: () => (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      startMonth={new Date(2024, 0)}
      endMonth={new Date(2028, 11)}
      defaultMonth={new Date(2026, 9)}
      className="rounded-lg border border-border"
    />
  ),
};
