# Douyin Streak Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows tool that opens a dedicated Edge profile after login and sends “。” once per calendar day to each configured Douyin friend.

**Architecture:** A TypeScript command-line application separates configuration, daily state, browser interaction, orchestration, and Windows startup registration. Playwright drives a visible persistent Edge context; a dry-run performs every lookup but never submits a message. Real-site selectors remain inside one page-object module, while deterministic fixture pages cover automated tests.

**Tech Stack:** Node.js 22+, TypeScript 5, Playwright, Vitest, Zod, Windows Task Scheduler (`schtasks.exe`)

**Spec:** `docs/superpowers/specs/2026-08-27-douyin-streak-automation-design.md`

## Global Constraints

- Target Windows 10 or later and installed Microsoft Edge.
- Use a dedicated Edge user-data directory; never read the user's normal Edge profile.
- The outgoing message is exactly `。`.
- A friend is marked successful only after the outgoing message is observed in the active conversation.
- Never bypass login verification, CAPTCHA, or platform risk controls.
- Ambiguous identity, expired login, verification UI, or unconfirmed delivery must not produce a send action.
- Real-account validation begins in dry-run mode and requires the user to enable live sending explicitly.

---

## File Map

- `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`: Node, TypeScript, test, command setup, and local-data exclusion.
- `src/domain.ts`: shared types and result categories.
- `src/config.ts`: validated user configuration and safe defaults.
- `src/state.ts`: atomic per-day success records.
- `src/logger.ts`: JSON-lines logs and failure screenshots.
- `src/douyin-page.ts`: all Douyin selectors, identity checks, and send confirmation.
- `src/run.ts`: friend-by-friend orchestration and retry policy.
- `src/cli.ts`: `setup`, `dry-run`, `run`, and startup commands.
- `src/startup.ts`: current-user Windows Task Scheduler integration.
- `tests/fixtures/douyin.html`: deterministic fake message page.
- `tests/*.test.ts`: unit and browser-flow coverage without contacting Douyin.
- `config.example.json`: documented friend configuration.
- `README.md`: setup, preview, activation, logs, and recovery instructions.

### Task 1: Project foundation and validated configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/domain.ts`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`
- Create: `config.example.json`

**Interfaces:**
- Produces: `FriendConfig`, `AppConfig`, `loadConfig(path: string): Promise<AppConfig>`

- [ ] **Step 1: Write the failing configuration tests**

```ts
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("accepts a uniquely identifiable friend", () => {
    const value = parseConfig({ enabled: false, friends: [{ nickname: "小明", douyinId: "ming-1" }] });
    expect(value.message).toBe("。");
    expect(value.friends[0].douyinId).toBe("ming-1");
  });

  it("rejects a friend with only a nickname", () => {
    expect(() => parseConfig({ enabled: false, friends: [{ nickname: "小明" }] })).toThrow(/douyinId|profileUrl/);
  });
});
```

- [ ] **Step 2: Add toolchain files and run the test to verify failure**

```json
{
  "name": "douyin-streak-automation",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run", "start": "tsx src/cli.ts" },
  "dependencies": { "playwright": "^1.55.0", "zod": "^4.1.0" },
  "devDependencies": { "@types/node": "^22.15.0", "tsx": "^4.20.0", "typescript": "^5.9.0", "vitest": "^3.2.0" }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", testTimeout: 15_000 } });
```

```gitignore
node_modules/
dist/
config.json
*.log
```

Run: `npm install && npm test -- tests/config.test.ts`

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 3: Implement the domain types and parser**

```ts
// src/domain.ts
export type FriendConfig = { nickname: string; douyinId?: string; profileUrl?: string };
export type AppConfig = { enabled: boolean; message: "。"; friends: FriendConfig[] };

// src/config.ts
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { AppConfig } from "./domain.js";

const friendSchema = z.object({
  nickname: z.string().min(1),
  douyinId: z.string().min(1).optional(),
  profileUrl: z.string().url().optional()
}).refine((x) => x.douyinId || x.profileUrl, "Each friend requires douyinId or profileUrl");
const schema = z.object({ enabled: z.boolean().default(false), message: z.literal("。").default("。"), friends: z.array(friendSchema).min(1) });
export const parseConfig = (input: unknown): AppConfig => schema.parse(input);
export async function loadConfig(path: string): Promise<AppConfig> {
  return parseConfig(JSON.parse(await readFile(path, "utf8")));
}
```

- [ ] **Step 4: Add an example config and verify**

```json
{
  "enabled": false,
  "message": "。",
  "friends": [{ "nickname": "好友昵称", "douyinId": "请替换为抖音号" }]
}
```

Run: `npm test -- tests/config.test.ts && npm run build`

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```powershell
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/domain.ts src/config.ts tests/config.test.ts config.example.json
git commit -m "feat: add validated friend configuration"
```

### Task 2: Atomic daily success state

**Files:**
- Create: `src/state.ts`
- Create: `tests/state.test.ts`

**Interfaces:**
- Consumes: `FriendConfig`
- Produces: `friendKey(friend): string`, `DailyStateStore.pending(date, friends)`, `DailyStateStore.markSuccess(date, friend)`

- [ ] **Step 1: Write failing state tests**

```ts
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
```

- [ ] **Step 2: Run the focused test**

Run: `npm test -- tests/state.test.ts`

Expected: FAIL because `DailyStateStore` is missing.

- [ ] **Step 3: Implement atomic state storage**

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FriendConfig } from "./domain.js";

type State = Record<string, Record<string, { successAt: string }>>;
export const friendKey = (friend: FriendConfig) => friend.douyinId ?? friend.profileUrl!;
export class DailyStateStore {
  constructor(private readonly path: string) {}
  private async read(): Promise<State> {
    try { return JSON.parse(await readFile(this.path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  }
  async pending(date: string, friends: FriendConfig[]) {
    const successful = (await this.read())[date] ?? {};
    return friends.filter((friend) => !successful[friendKey(friend)]);
  }
  async markSuccess(date: string, friend: FriendConfig) {
    const state = await this.read();
    state[date] ??= {};
    state[date][friendKey(friend)] = { successAt: new Date().toISOString() };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.new`;
    await writeFile(temporary, JSON.stringify(state, null, 2));
    await rename(temporary, this.path);
  }
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm test -- tests/state.test.ts && npm run build`

Expected: PASS and exit 0.

```powershell
git add src/state.ts tests/state.test.ts
git commit -m "feat: prevent duplicate daily messages"
```

### Task 3: Structured logs and diagnostic screenshots

**Files:**
- Create: `src/logger.ts`
- Create: `tests/logger.test.ts`

**Interfaces:**
- Produces: `RunLogger.event(entry)`, `RunLogger.screenshot(page, friendKey, reason)`

- [ ] **Step 1: Test JSON-lines output and safe filenames**

```ts
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
```

- [ ] **Step 2: Run the test and implement the logger**

Run: `npm test -- tests/logger.test.ts`

Expected: FAIL because `RunLogger` is missing.

```ts
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";

export class RunLogger {
  constructor(private readonly directory: string) {}
  screenshotPath(friend: string, reason: string) {
    const safe = `${friend}-${reason}`.replace(/[\\/:*?"<>|]/g, "_");
    return join(this.directory, `${safe}-${Date.now()}.png`);
  }
  async event(entry: Record<string, unknown>) {
    await mkdir(this.directory, { recursive: true });
    await appendFile(join(this.directory, "run.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  }
  async screenshot(page: Page, friend: string, reason: string) {
    await mkdir(this.directory, { recursive: true });
    const path = this.screenshotPath(friend, reason);
    await page.screenshot({ path, fullPage: true });
    return path;
  }
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm test -- tests/logger.test.ts && npm run build`

Expected: PASS and exit 0.

```powershell
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: add run logs and diagnostics"
```

### Task 4: Douyin page object with dry-run protection

**Files:**
- Create: `src/douyin-page.ts`
- Create: `tests/fixtures/douyin.html`
- Create: `tests/douyin-page.test.ts`

**Interfaces:**
- Consumes: `FriendConfig`, Playwright `Page`
- Produces: `DouyinPage.assertReady()`, `DouyinPage.processFriend(friend, mode): Promise<FriendResult>`

- [ ] **Step 1: Create a fixture and failing browser-flow tests**

```html
<input aria-label="搜索" />
<section aria-label="搜索结果"></section>
<main aria-label="聊天"></main>
<textarea aria-label="发送消息"></textarea><button>发送</button>
<script>
  const data = [{ nickname: "小明", id: "ming-1" }, { nickname: "小明", id: "ming-2" }];
  document.querySelector('input').addEventListener('input', (e) => {
    document.querySelector('section').innerHTML = data.filter(x => x.nickname.includes(e.target.value))
      .map(x => `<button data-friend-id="${x.id}">${x.nickname} 抖音号：${x.id}</button>`).join('');
  });
  document.querySelector('section').addEventListener('click', (e) => document.querySelector('main').dataset.friendId = e.target.dataset.friendId);
  document.querySelector('button:not([data-friend-id])').addEventListener('click', () => {
    const text = document.querySelector('textarea').value;
    document.querySelector('main').insertAdjacentHTML('beforeend', `<p data-outgoing="true">${text}</p>`);
  });
</script>
```

```ts
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DouyinPage } from "../src/douyin-page.js";

it("dry-run locates the exact id without sending", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve("tests/fixtures/douyin.html")).href);
  const result = await new DouyinPage(page).processFriend({ nickname: "小明", douyinId: "ming-1" }, "dry-run");
  expect(result.status).toBe("located");
  expect(await page.locator("[data-outgoing=true]").count()).toBe(0);
  await browser.close();
});
```

- [ ] **Step 2: Run the browser test**

Run: `npx playwright install chromium && npm test -- tests/douyin-page.test.ts`

Expected: FAIL because `DouyinPage` is missing.

- [ ] **Step 3: Implement exact identity matching and confirmation**

```ts
import type { Page } from "playwright";
import type { FriendConfig } from "./domain.js";

export type FriendResult = { status: "located" | "success" | "ambiguous" | "not-found" | "unconfirmed"; detail?: string };
export class DouyinPage {
  constructor(private readonly page: Page) {}
  async assertReady() {
    if (await this.page.getByText(/验证码|扫码登录|登录后/).count()) throw new Error("LOGIN_OR_VERIFICATION_REQUIRED");
  }
  async processFriend(friend: FriendConfig, mode: "dry-run" | "live"): Promise<FriendResult> {
    const search = this.page.getByRole("textbox", { name: /搜索/ }).first();
    await search.fill(friend.nickname);
    const identity = friend.douyinId ?? friend.profileUrl!;
    const matches = this.page.getByRole("button").filter({ hasText: identity });
    const count = await matches.count();
    if (count === 0) return { status: "not-found", detail: identity };
    if (count !== 1) return { status: "ambiguous", detail: identity };
    await matches.click();
    if (mode === "dry-run") return { status: "located" };
    const composer = this.page.getByRole("textbox", { name: /发送消息/ }).last();
    await composer.fill("。");
    await this.page.getByRole("button", { name: /^发送$/ }).click();
    const outgoing = this.page.locator('[data-outgoing="true"]').filter({ hasText: /^。$/ }).last();
    try { await outgoing.waitFor({ state: "visible", timeout: 8_000 }); return { status: "success" }; }
    catch { return { status: "unconfirmed" }; }
  }
}
```

- [ ] **Step 4: Add tests for exact live send, missing friend, and ambiguous identity**

```ts
it("live mode sends exactly one full-width stop", async () => {
  const browser = await chromium.launch(); const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve("tests/fixtures/douyin.html")).href);
  expect((await new DouyinPage(page).processFriend({ nickname: "小明", douyinId: "ming-1" }, "live")).status).toBe("success");
  expect(await page.locator("[data-outgoing=true]").allTextContents()).toEqual(["。"]) ;
  await browser.close();
});
```

Run: `npm test -- tests/douyin-page.test.ts && npm run build`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/douyin-page.ts tests/fixtures/douyin.html tests/douyin-page.test.ts
git commit -m "feat: automate verified Douyin conversations"
```

### Task 5: Orchestration, retries, and success-only state updates

**Files:**
- Create: `src/run.ts`
- Create: `tests/run.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `DailyStateStore`, `RunLogger`, object exposing `processFriend`
- Produces: `runFriends(deps, date, mode): Promise<RunSummary>`

- [ ] **Step 1: Write a failing success-only persistence test**

```ts
import { expect, it, vi } from "vitest";
import { runFriends } from "../src/run.js";

it("marks only confirmed successes and continues after a failure", async () => {
  const friends = [{ nickname: "甲", douyinId: "a" }, { nickname: "乙", douyinId: "b" }];
  const state = { pending: vi.fn().mockResolvedValue(friends), markSuccess: vi.fn() };
  const page = { processFriend: vi.fn().mockResolvedValueOnce({ status: "unconfirmed" }).mockResolvedValueOnce({ status: "success" }) };
  const logger = { event: vi.fn(), screenshot: vi.fn() };
  const summary = await runFriends({ config: { enabled: true, message: "。", friends }, state, page, logger }, "2026-08-27", "live");
  expect(summary).toEqual({ success: 1, failed: 1, skipped: 0 });
  expect(state.markSuccess).toHaveBeenCalledTimes(1);
  expect(state.markSuccess).toHaveBeenCalledWith("2026-08-27", friends[1]);
});
```

- [ ] **Step 2: Run the test and implement orchestration**

Run: `npm test -- tests/run.test.ts`

Expected: FAIL because `runFriends` is missing.

```ts
import type { AppConfig, FriendConfig } from "./domain.js";
type Result = { status: "located" | "success" | "ambiguous" | "not-found" | "unconfirmed"; detail?: string };
type Deps = { config: AppConfig; state: { pending(d: string, f: FriendConfig[]): Promise<FriendConfig[]>; markSuccess(d: string, f: FriendConfig): Promise<void> }; page: { processFriend(f: FriendConfig, m: "dry-run" | "live"): Promise<Result> }; logger: { event(e: Record<string, unknown>): Promise<void> } };
export async function runFriends(deps: Deps, date: string, mode: "dry-run" | "live") {
  const pending = await deps.state.pending(date, deps.config.friends);
  const summary = { success: 0, failed: 0, skipped: deps.config.friends.length - pending.length };
  for (const friend of pending) {
    let result: Result = { status: "unconfirmed" };
    for (let attempt = 1; attempt <= 3; attempt++) {
      result = await deps.page.processFriend(friend, mode);
      if (result.status !== "unconfirmed") break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
    if (result.status === "success") { await deps.state.markSuccess(date, friend); summary.success++; }
    else if (result.status === "located") summary.success++;
    else summary.failed++;
    await deps.logger.event({ friend: friend.douyinId ?? friend.profileUrl, mode, ...result });
  }
  return summary;
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm test -- tests/run.test.ts && npm test && npm run build`

Expected: complete suite PASS.

```powershell
git add src/run.ts tests/run.test.ts
git commit -m "feat: orchestrate safe daily sends"
```

### Task 6: CLI, persistent Edge setup, and explicit activation

**Files:**
- Create: `src/cli.ts`
- Create: `tests/cli.test.ts`

**Interfaces:**
- Consumes: all earlier modules
- Produces commands: `setup`, `dry-run`, `run`

- [ ] **Step 1: Test that disabled configuration blocks live mode**

```ts
import { expect, it } from "vitest";
import { assertModeAllowed } from "../src/cli.js";

it("requires explicit enabled true for live sending", () => {
  expect(() => assertModeAllowed({ enabled: false }, "live")).toThrow(/enabled/);
  expect(() => assertModeAllowed({ enabled: false }, "dry-run")).not.toThrow();
});
```

- [ ] **Step 2: Implement CLI wiring**

```ts
import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { DailyStateStore } from "./state.js";
import { RunLogger } from "./logger.js";
import { DouyinPage } from "./douyin-page.js";
import { runFriends } from "./run.js";

export function assertModeAllowed(config: { enabled: boolean }, mode: "dry-run" | "live") {
  if (mode === "live" && !config.enabled) throw new Error("Live sending requires enabled=true after a successful dry-run");
}
export async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const root = join(homedir(), ".douyin-streak");
  const context = await chromium.launchPersistentContext(join(root, "edge-profile"), { channel: "msedge", headless: false });
  if (command === "setup") { await context.pages()[0].goto("https://www.douyin.com/"); return; }
  const mode = command === "dry-run" ? "dry-run" : "live";
  const config = await loadConfig(join(process.cwd(), "config.json"));
  assertModeAllowed(config, mode);
  const page = context.pages()[0];
  await page.goto("https://www.douyin.com/");
  const douyin = new DouyinPage(page); await douyin.assertReady();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  await runFriends({ config, state: new DailyStateStore(join(root, "state.json")), page: douyin, logger: new RunLogger(join(root, "logs", date)) }, date, mode);
  await context.close();
}
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) main().catch((error) => { console.error(error); process.exitCode = 1; });
```

- [ ] **Step 3: Verify commands without contacting Douyin in tests**

Run: `npm test -- tests/cli.test.ts && npm run build`

Expected: PASS and exit 0. Do not run `setup`, `dry-run`, or `run` during automated verification.

- [ ] **Step 4: Commit**

```powershell
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: add guarded Edge automation CLI"
```

### Task 7: Windows login trigger and operator documentation

**Files:**
- Create: `src/startup.ts`
- Create: `tests/startup.test.ts`
- Modify: `src/cli.ts`
- Create: `README.md`

**Interfaces:**
- Produces: `startupCommand(projectDir): string`, CLI commands `startup-install`, `startup-remove`

- [ ] **Step 1: Test the scheduled command quoting and delay**

```ts
import { expect, it } from "vitest";
import { startupArgs } from "../src/startup.js";

it("registers a current-user logon task with a 90 second delay", () => {
  const args = startupArgs("C:\\Tools\\Douyin Streak");
  expect(args).toContain("ONLOGON");
  expect(args).toContain("0000:01:30");
  expect(args.join(" ")).toContain("Douyin Streak");
});
```

- [ ] **Step 2: Implement startup install and removal**

```ts
import { spawn } from "node:child_process";
import { join } from "node:path";
export const TASK_NAME = "DouyinStreakDaily";
export function startupArgs(projectDir: string) {
  const command = `\"${process.execPath}\" \"${join(projectDir, "dist", "cli.js")}\" run`;
  return ["/Create", "/F", "/TN", TASK_NAME, "/SC", "ONLOGON", "/DELAY", "0000:01:30", "/TR", command];
}
const schtasks = (args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn("schtasks.exe", args, { stdio: "inherit" });
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`schtasks exited ${code}`)));
});
export const installStartup = (projectDir: string) => schtasks(startupArgs(projectDir));
export const removeStartup = () => schtasks(["/Delete", "/F", "/TN", TASK_NAME]);
```

- [ ] **Step 3: Wire the two startup commands into `main` before the persistent browser context is created**

```ts
if (command === "startup-install") { const { installStartup } = await import("./startup.js"); await installStartup(process.cwd()); return; }
if (command === "startup-remove") { const { removeStartup } = await import("./startup.js"); await removeStartup(); return; }
```

- [ ] **Step 4: Write exact operator instructions**

```markdown
# 抖音火花自动续聊工具

1. 复制 `config.example.json` 为 `config.json`，填写昵称和抖音号。
2. 运行 `npm install && npm run build`。
3. 运行 `npm start -- setup`，在专用 Edge 中扫码登录，然后关闭窗口。
4. 运行 `npm start -- dry-run`，逐个确认程序定位的是正确好友；此命令不会发送消息。
5. 将 `config.json` 的 `enabled` 改为 `true`，再运行一次 `npm start -- run` 做受控验收。
6. 验收成功后运行 `npm start -- startup-install`。删除开机任务使用 `npm start -- startup-remove`。

状态、日志和截图保存在 `%USERPROFILE%\.douyin-streak`。出现验证码、登录过期或好友识别错误时，先运行 `npm start -- setup` 人工处理，再重新预演。
```

- [ ] **Step 5: Run complete verification**

Run: `npm test && npm run build && git diff --check`

Expected: all tests PASS, build exits 0, and `git diff --check` prints nothing.

- [ ] **Step 6: Commit**

```powershell
git add src/startup.ts src/cli.ts tests/startup.test.ts README.md
git commit -m "feat: add Windows startup and operator guide"
```

### Task 8: Controlled real-site preview and activation

**Files:**
- Modify only if live inspection proves selectors differ: `src/douyin-page.ts`
- Modify corresponding fixture contract: `tests/fixtures/douyin.html`
- Modify corresponding tests: `tests/douyin-page.test.ts`

**Interfaces:**
- Validates the complete user-facing workflow without broadening automation permissions.

- [ ] **Step 1: Initialize the dedicated profile**

Run: `npm start -- setup`

Expected: a visible dedicated Edge window opens at Douyin; the user scans the QR code and can manually open messages.

- [ ] **Step 2: Run the non-sending preview**

Run: `npm start -- dry-run`

Expected: every configured friend is uniquely located, no chat receives a new message, and each result is written as `located` in the JSON-lines log.

- [ ] **Step 3: If selectors differ, capture evidence and update only the page object contract**

Use Playwright Inspector with `PWDEBUG=1` and run `npm start -- dry-run`. Replace the failing accessible locator in `src/douyin-page.ts`, mirror the observed accessible name in `tests/fixtures/douyin.html`, and add a regression assertion to `tests/douyin-page.test.ts` before repeating the dry-run.

- [ ] **Step 4: Enable and perform one controlled live run**

Set `"enabled": true` in the untracked local `config.json`, then run: `npm start -- run`

Expected: each configured friend receives exactly one `。`; the state file contains one success entry per friend for the current Asia/Shanghai date.

- [ ] **Step 5: Verify same-day deduplication**

Run: `npm start -- run`

Expected: no browser send action occurs and the summary reports every configured friend as skipped.

- [ ] **Step 6: Install and inspect the login task**

Run: `npm start -- startup-install && schtasks.exe /Query /TN DouyinStreakDaily /V /FO LIST`

Expected: the task trigger is user logon, delay is 90 seconds, and the action points to this project's compiled CLI with the `run` argument.

- [ ] **Step 7: Commit any selector corrections after tests pass**

```powershell
npm test
npm run build
git add src/douyin-page.ts tests/fixtures/douyin.html tests/douyin-page.test.ts
git commit -m "fix: align Douyin page locators with live UI"
```

If no selector correction was needed, do not create an empty commit.
