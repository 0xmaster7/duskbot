# Phone push

A paired phone gets a push for a notification (a reply, a question, an approval) when the app is in the background or
closed. While the app is open it shows the notification itself, so nothing buzzes twice.

## How the workspace decides

The workspace (your computer or server) decides, per phone:

- The app tells the workspace when it opens and when it goes to the background (`PUT /api/mobile/presence`), and keeps
  saying it is open every 25 seconds. An app that stops saying so for 60 seconds (killed, suspended, out of signal)
  counts as away.
- A phone that is away gets the push at once. A phone that never reported (an older app, or a workspace that just
  restarted) counts as away.
- An event that lands while the app is open is held for 5 minutes. If the phone goes away and stays away for 3 seconds,
  the held events it has not read yet go out as pushes, the newest per conversation. If it comes back within those 3
  seconds, nothing is sent.
- A push the service could not take is tried again after 10 seconds and after 60 seconds, while the phone is still away
  and the notification is unread. A token APNs or FCM calls dead is dropped; the app registers again next time it opens.

The code is in `server/mobile/presence.ts` (the rule), `server/mobile/link.ts` (wiring) and `server/mobile/push.ts`
(sending).

## Where pushes leave from

APNs and FCM accept pushes only from whoever holds the app's keys. A workspace sends a push:

1. with its own keys, when `OMB_APNS_*` or `OMB_FCM_SERVICE_ACCOUNT_FILE` are set on it (below), else
2. through a push relay: `OMB_PUSH_RELAY` if set (`off` turns this off), else the link service its VPS link agent uses,
   else `OMB_MOBILE_RELAY`, else `https://link.apps.siddz.com`.

The relay is `POST /v1/push` on the link service (`link-service/src/push-relay.mjs`). It sees the device token, APNs or
FCM, the bot's name and the ids a tap opens (notification, bot, conversation, room). It never gets a notification's
title or any message text, keeps nothing, and logs no token. Apple and Google see the same: the lock screen shows the
bot's name and "New message". It allows 20 pushes a minute per device token and 240 per address.

## Setup you have to do

None of this is in the repo: keys and Firebase files are secrets or tied to your developer accounts.

### iOS (APNs)

1. In the Apple Developer account that signs the app (bundle id `com.openmausbot.mobile`), open Certificates, IDs &
   Profiles, Keys, and create a key with **Apple Push Notifications service (APNs)** enabled. Download the `.p8` file
   (only once) and note its Key ID and your Team ID.
2. In Xcode, open `apps/mobile/ios/App/App.xcworkspace`, select the App target, Signing & Capabilities, and add
   **Push Notifications**. Xcode writes the `aps-environment` entitlement; commit that change.
3. Put the key where the pushes leave from (the link service host for the relay, or the workspace itself) and set:
   - `OMB_APNS_KEY_FILE`: path to the `.p8` file (readable only by the service user, `chmod 600`)
   - `OMB_APNS_KEY_ID`: the key's ID
   - `OMB_APNS_TEAM_ID`: your Team ID
   - `OMB_APNS_TOPIC`: `com.openmausbot.mobile`
4. Restart the link service (or the workspace). `GET /v1/push` on the link service should answer
   `{"services":["apns",...]}`.

A build run from Xcode gets sandbox tokens; TestFlight and App Store builds get production tokens. The app marks its
token sandbox only when its web part was built in development mode, so for a push test from Xcode build with
`OMB_MOBILE_DEV_URL` (live reload) or use TestFlight; a production-marked sandbox token is refused by APNs and dropped.

### Android (FCM)

1. In the Firebase console, create a project (or use one), add an Android app with package `com.openmausbot.mobile`,
   and download `google-services.json` into `apps/mobile/android/app/` (it is already git-ignored there; the build
   applies the Google services plugin only when the file exists). Rebuild the app.
2. In Project settings, Service accounts, generate a new private key. That JSON file is a secret.
3. Where the pushes leave from, set `OMB_FCM_SERVICE_ACCOUNT_FILE` to that file's path (`chmod 600`) and restart.

### Check it

1. Pair the phone, allow notifications when asked, and open Settings, Notifications in the app once.
2. Put the app in the background, then make a bot answer you (or ask you something) from the desktop.
3. The phone should get "{bot name}: New message" within a few seconds; tapping it opens that conversation.

If nothing arrives, the workspace log says `mobile push: no APNs or FCM credentials and no push relay on this server`
when it has neither, and `GET /v1/push` on the relay lists what the relay can send.
