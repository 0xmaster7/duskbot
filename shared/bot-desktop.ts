// The bot computer image (deploy/bot-desktop). One line each: deploy/bot-desktop/build.sh reads these two constants.
export const BOT_DESKTOP_VERSION = "3";
export const BOT_DESKTOP_IMAGE = "ghcr.io/sidddevz/omb-bot-desktop:v3";

/** Image label carrying BOT_DESKTOP_VERSION; containers made from the image carry it too. */
export const BOT_DESKTOP_LABEL = "bot.dusk.bot-desktop";
/** The Docker network every bot desktop on a host joins: no inter-container traffic, fenced by the host or by each box. */
export const BOT_DESKTOP_NETWORK = "duskbot-desktops";
export const BOT_DESKTOP_NETWORK_LABEL = "bot.dusk.vps-network";
/** The network's bridge interface on the host: deploy/bot-desktop/host-fence.sh keys every rule on this name. */
export const BOT_DESKTOP_BRIDGE = "omb-desk0";
/** "free" (host-fenced, sudo inside) or "strict" (self-fenced, read-only, no sudo); see server/bot-desktop.ts. */
export const BOT_DESKTOP_MODE_LABEL = "bot.dusk.bot-desktop-mode";
/** The only mount: a named volume holding the bot's home (saved files, browser profile, terminal history). */
export const BOT_DESKTOP_HOME = "/home/cua";
