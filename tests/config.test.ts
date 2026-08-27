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
