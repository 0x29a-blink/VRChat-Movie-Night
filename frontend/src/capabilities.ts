import type { UserInfo } from "./types";

// Plan 030 (fix I): single source of truth for the player-control capability
// check, replacing local copies that had drifted between Tonight.tsx and
// SessionStrip.tsx.
export const canControlPlayer = (user: UserInfo) => user.capabilities?.can_control_player !== false;
