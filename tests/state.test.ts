import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DailyStateStore } from "../src/state.js";

it("returns only friends not successful on the date", async () => {
  const dir = await mkdtemp(join(tmpdir(), "streak-state-"));
  const store = new DailyStateStore(join(dir, "state.json"));
  const a = { nickname: "甲", douyinId: "a" };
  const b = { nickname: "乙", douyinId: "b" };
  await store.markSuccess("2026-08-27", a);
  expect(await store.pending("2026-08-27", [a, b])).toEqual([b]);
  expect(await store.pending("2026-08-28", [a, b])).toEqual([a, b]);
});

it("preserves all records when successes are marked concurrently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "streak-state-"));
  const store = new DailyStateStore(join(dir, "state.json"));
  const friends = Array.from({ length: 20 }, (_, index) => ({
    nickname: `朋友${index}`,
    douyinId: `id-${index}`,
  }));

  await Promise.all(friends.map((friend) => store.markSuccess("2026-08-27", friend)));

  expect(await store.pending("2026-08-27", friends)).toEqual([]);
});
