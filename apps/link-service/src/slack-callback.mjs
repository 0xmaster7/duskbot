const STATE = /^[0-9a-f]{64}$/;
const CODE = /^[A-Za-z0-9._-]{8,256}$/;
const ERROR = /^[a-z_]{1,64}$/;
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function slackCallback(res, params) {
  const states = params.getAll("state");
  const codes = params.getAll("code");
  const errors = params.getAll("error");
  const valid = states.length === 1 && STATE.test(states[0]) && (
    (codes.length === 1 && errors.length === 0 && CODE.test(codes[0])) ||
    (errors.length === 1 && codes.length === 0 && ERROR.test(errors[0]))
  );
  let content = "<h1>This Slack link is not valid. Start again from dusk bot.</h1>";
  let refresh = "";
  if (valid) {
    const query = new URLSearchParams(codes.length ? { code: codes[0], state: states[0] } : { error: errors[0], state: states[0] });
    const link = escapeHtml(`duskbot://slack/oauth?${query}`);
    const denied = errors[0] === "access_denied";
    refresh = `<meta http-equiv="refresh" content="0;url=${link}">`;
    content = `<h1>${escapeHtml(denied ? "Slack didn't add the bot" : "Returning to dusk bot")}</h1>
<p>${denied ? "You can close this tab." : "If nothing happens, open dusk bot yourself."}</p>
<p><a href="${link}">Open dusk bot</a></p>
<p>Or copy this link and paste it into dusk bot:</p>
<code>${link}</code>`;
  }
  res.writeHead(valid ? 200 : 400, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Returning to dusk bot</title>
${refresh}
<style>
body{font-family:system-ui,sans-serif;background:#fafafa;color:#222;margin:0;min-height:100vh;display:grid;place-items:center}
main{max-width:38rem;padding:2rem;text-align:center}h1{font-size:1.5rem}a{color:#175bb5}code{display:block;overflow-wrap:anywhere;user-select:all}
@media(prefers-color-scheme:dark){body{background:#171717;color:#eee}a{color:#91bfff}}
</style>
</head>
<body><main>${content}</main></body>
</html>`);
}
