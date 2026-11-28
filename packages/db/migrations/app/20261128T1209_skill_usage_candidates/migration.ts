#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0afeeb830835c1a111e5003744b1fb67e0fa0e1f89e6213b0ef2535adc60966f/contract';
import startContract from '../../snapshots/0afeeb830835c1a111e5003744b1fb67e0fa0e1f89e6213b0ef2535adc60966f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/4b0efa032438b801aabe2792310769aac79b16a4c84805813929e9c776dbfc1a/contract';
import endContract from '../../snapshots/4b0efa032438b801aabe2792310769aac79b16a4c84805813929e9c776dbfc1a/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'Event',
        index: 'Event_skill_usage_777c0615',
        columns: ['threadId', 'at'],
        extras: {
          where: sql`("type" IN ('context-loaded', 'tool-called') AND (strpos("canonical", '"skill"') > 0 OR strpos("canonical", chr(92) || 'u') > 0))`,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
