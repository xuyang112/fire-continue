import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { AppConfig } from "./domain.js";

const friendSchema = z.object({
  nickname: z.string().min(1),
  douyinId: z.string().min(1).optional(),
  profileUrl: z.string().url().optional(),
}).refine((x) => x.douyinId || x.profileUrl, "Each friend requires douyinId or profileUrl");

const schema = z.object({
  enabled: z.boolean().default(false),
  message: z.literal("。").default("。"),
  friends: z.array(friendSchema).min(1),
});

export const parseConfig = (input: unknown): AppConfig => schema.parse(input);

export async function loadConfig(path: string): Promise<AppConfig> {
  return parseConfig(JSON.parse(await readFile(path, "utf8")));
}
