import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RunLogger } from "../src/logger.js";

it("writes one parseable event per line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "streak-log-"));
  const logger = new RunLogger(dir);

  await logger.event({ status: "success", friend: "a/b" });

  const line = (await readFile(join(dir, "run.jsonl"), "utf8")).trim();
  expect(JSON.parse(line).status).toBe("success");
  expect(logger.screenshotPath("a/b", "ambiguous")).not.toMatch(/[\\/:*?"<>|]/);
});
