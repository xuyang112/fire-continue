import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";

export class RunLogger {
  constructor(private readonly directory: string) {}

  screenshotPath(friend: string, reason: string): string {
    const safe = `${friend}-${reason}`.replace(/[\\/:*?"<>|]/g, "_");
    return `${safe}-${Date.now()}.png`;
  }

  async event(entry: Record<string, unknown>): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await appendFile(
      join(this.directory, "run.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  }

  async screenshot(page: Page, friend: string, reason: string): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, this.screenshotPath(friend, reason));
    await page.screenshot({ path, fullPage: true });
    return path;
  }
}
