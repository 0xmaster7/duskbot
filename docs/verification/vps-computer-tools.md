# What a bot can do on its VPS desktop

A bot with a computer on the person's VPS gets three kinds of tools for it:

- the Cua Driver screen tools (`get_window_state`, `run_steps`, `click`, `type_text`, `launch_app`, ...), through
  `server/vps-container-mcp.ts`;
- `vm_exec`, a shell command inside that desktop as its desktop user, starting in `/home/cua/workspace`, with the exit
  code, stdout and stderr returned (`server/vps-exec.ts`);
- `attach_file` with a `/home/cua/...` path, which copies the file (12 MB at most) from the desktop into the chat.

`vm_exec` and `attach_file` pass the same control gate as screen calls: while a person holds the computer they wait
and then refuse with the take-control text, and they wake a lazily claimed computer the same way.

The bot's own shell tool (Codex `exec_command`, Claude `Bash`) runs on the server, not in the desktop. The VPS prompt
paragraph says so, because a bot that runs `ls /home/cua/workspace` there finds nothing.

## The driver's browser tools are not listed

Cua Driver 0.37.0 in the bot desktop runs in standard mode without `--grant existing-profile`, so `get_browser_state`,
`browser_prepare`, `browser_*` and `page` refuse every Chromium window. The VPS bridge drops them, and the driver's
upkeep tools, from `tools/list` (66 tools to 37 on the v3 image), replaces the driver's MCP instructions with
sandbox guidance, and rewrites a `browser_consent_required` refusal into a next step instead of "authorize it".

Granting `existing-profile` in the image (the profile is the bot's own sandbox Chromium) would bring those typed
browser tools back. That is an image change and a security decision, not made here.

## Check

```sh
pnpm exec vitest run server/vps-exec.test.ts server/sandbox-computer-guidance.test.ts server/vps-routing.test.ts
```

On a live VPS, the same argv `vpsExecArgs` builds can be run by hand against a bot's container
(`docker exec -u cua -w /home/cua/workspace ... sh -c '<wrapper>' omb-exec 60 'ls -l' MARK:`); it prints the output and
`MARK:<exit code>` on stderr.
