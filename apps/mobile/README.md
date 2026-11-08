# OpenMausBot mobile

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
OMB_MOBILE_DEV_URL=http://localhost:5320 npx cap copy android
cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`localhost` keeps the WebView a secure context (WebCrypto needs one); without `OMB_MOBILE_DEV_URL` the app runs its
bundled build and pairs like a real phone.

## iOS simulator

Needs a simulator runtime (`xcodebuild -downloadPlatform iOS`).

```sh
cd apps/mobile
pnpm build && OMB_MOBILE_DEV_URL=http://localhost:5320 npx cap sync ios
npx cap run ios                                        # or: npx cap open ios
xcrun simctl io booted screenshot shot.png
```
