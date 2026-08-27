import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { FriendConfig } from "./domain.js";

type State = Record<string, Record<string, { successAt: string }>>;

export const friendKey = (friend: FriendConfig) => friend.douyinId ?? friend.profileUrl!;

export class DailyStateStore {
  constructor(private readonly path: string) {}
  private writeQueue: Promise<void> = Promise.resolve();

  private async read(): Promise<State> {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async pending(date: string, friends: FriendConfig[]) {
    const successful = (await this.read())[date] ?? {};
    return friends.filter((friend) => !successful[friendKey(friend)]);
  }

  async markSuccess(date: string, friend: FriendConfig) {
    const operation = this.writeQueue.then(async () => {
      const state = await this.read();
      state[date] ??= {};
      state[date][friendKey(friend)] = { successAt: new Date().toISOString() };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.new`;
      await writeFile(temporary, JSON.stringify(state, null, 2));
      await rename(temporary, this.path);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}
