# dusk bot mobile

The iOS and Android app: Capacitor around the React app, with the phone layer in `src/mobile/`.

## Web phone preview

```sh
pnpm mobile:preview --fixture                       # isolated fixture server, fake engine
pnpm mobile:preview --url http://127.0.0.1:8799     # a workspace already running here
```

Open http://127.0.0.1:5320/phone.html (390x844 and 430x932 frames, Dark and Pair screen toggles).

## Android emulator

```sh
cd apps/mobile
pnpm build && npx cap sync android
adb reverse tcp:5320 tcp:5320                          # dev only: lets the app reach the preview server
DUSK_MOBILE_DEV_URL=http://localhost:5320 npx cap copy android
cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`localhost` keeps the WebView a secure context (WebCrypto needs one); without `DUSK_MOBILE_DEV_URL` the app runs its
bundled build and pairs like a real phone.

## iOS simulator

Needs a simulator runtime (`xcodebuild -downloadPlatform iOS`).

```sh
cd apps/mobile
pnpm build && DUSK_MOBILE_DEV_URL=http://localhost:5320 npx cap sync ios
npx cap run ios                                        # or: npx cap open ios
xcrun simctl io booted screenshot shot.png
```

## Demo workspace

"Try the demo" on the sign-in and pairing screens opens a workspace that lives in the page (`src/mobile/demo/`): a sample
team, a room, and replies that say they are pretend. It needs no server and no account, and is what a store reviewer
uses. In the browser preview: `localStorage.setItem("dusk.mobile.demo", "1")` and reload.

## Store builds

```sh
pnpm mobile:release      # build the bundle, run the release gate, cap sync
pnpm mobile:gate         # the gate alone, on apps/mobile/dist
```

The gate (`scripts/release-gate.mjs`) refuses a bundle that carries material flagged by the copy audit or development
leftovers, and the Xcode Release configuration runs it before anything else. `VITE_DUSK_ALLOW_SIGNED_OUT=1` builds an
app that pairs without the account sign-in screen.

- `node apps/mobile/scripts/make-icons.mjs` redraws the app icon and launch images from `build/icon.svg`.
- `node --experimental-strip-types apps/mobile/scripts/store-shots.ts <preview address> docs/store/ios` draws the store
  screenshot set from the demo workspace.
- Readiness notes, the App Store checklist and the steps left: `docs/mobile-readiness.md`. Listing text:
  `docs/store/ios-listing.md`.
