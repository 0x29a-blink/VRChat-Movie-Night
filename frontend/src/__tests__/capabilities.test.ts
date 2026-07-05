import { describe, expect, it } from "vitest";
import { canControlPlayer } from "../capabilities";
import type { UserInfo } from "../types";

function makeUser(overrides: Partial<UserInfo> = {}): UserInfo {
  return {
    id: 1,
    username: "host",
    role: "admin",
    ...overrides,
  };
}

describe("canControlPlayer", () => {
  it("defaults to true when capabilities are absent", () => {
    expect(canControlPlayer(makeUser())).toBe(true);
  });

  it("is false only when can_control_player is explicitly false", () => {
    const user = makeUser({
      capabilities: {
        can_manage_settings: true,
        can_manage_users: true,
        can_manage_streaming: true,
        can_control_player: false,
        can_download_to_server: true,
        can_open_torbox_local_download: true,
        can_manage_watchlist: true,
      },
    });
    expect(canControlPlayer(user)).toBe(false);
  });
});
