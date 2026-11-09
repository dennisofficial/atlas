#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/e0eb0bdf7772e30f41d90fe70ec8ee76922e5d4355f15dda7d6cb929a897005a/contract';
import startContract from '../../snapshots/e0eb0bdf7772e30f41d90fe70ec8ee76922e5d4355f15dda7d6cb929a897005a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fb4a01e3e565fbd17d8a11d9d55a9d020162246ae2303cef78babdc52b7b84dd/contract';
import endContract from '../../snapshots/fb4a01e3e565fbd17d8a11d9d55a9d020162246ae2303cef78babdc52b7b84dd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: 'v2', table: 'V2Session', column: 'peerMessagesSent' })];
  }
}

MigrationCLI.run(import.meta.url, M);
