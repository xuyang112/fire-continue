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
