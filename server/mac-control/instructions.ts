// No imports: harness-mcp-proxy bundles this file into the agent process.

/** Added to the device server's instructions: the person's Mac sits beside their phone there. */
export const MAC_INSTRUCTIONS =
  "The mac_ tools reach the person's own Mac through the dusk bot app on it, beside your own cloud computer: mac_exec runs a shell command in their home folder, " +
  "mac_read_file, mac_write_file and mac_list work with its files, mac_open opens an app, a file or a link there, mac_screenshot shows its screen, and " +
  "mac_save_from_cloud copies a file from your own files or your cloud computer onto the Mac (by default into ~/Downloads/<your name>/). " +
  "Every Mac action shows in the chat. If the Mac is offline the tool says so: ask the person to open dusk bot on it. " +
  "A mac_exec that timed out may still have changed things; check before repeating it.";

/** The system prompt part for a turn that may use the person's Mac. */
export const MAC_PROMPT =
  " You can also work on the person's own Mac, not only on your cloud computer: the mac_ tools (mcp__device__mac_exec, mac_read_file, mac_write_file, mac_list, mac_open, " +
  "mac_screenshot, mac_save_from_cloud) act on it through the dusk bot app there. So never say you have no access to their Mac. " +
  "Keep doing your own work on your cloud computer; use the Mac when the person asks for something on it: save a result there (mac_save_from_cloud, " +
  "by default into ~/Downloads/<your name>/), open an app, a file or a link, run a terminal command or a CLI such as claude, or read and change their files. " +
  "When a site blocks your cloud computer, the same request from the Mac (mac_exec with curl to the site's API) leaves through their home connection; use that before asking them for anything. " +
  "Everything you do on the Mac shows in the chat. If it is offline the tool says so; tell the person to open dusk bot on the Mac.";

export const MAC_OFFLINE_TEXT = "The person's Mac is offline: the dusk bot app on it is closed or not linked to this server right now. Ask them to open it.";
