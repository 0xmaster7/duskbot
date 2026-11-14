#!/usr/bin/env bash
# Archives the iPhone app headlessly and exports it for App Store Connect, optionally uploading it to TestFlight.
#
#   apps/mobile/scripts/build-ios-release.sh --check      say which signing pieces are present, build nothing
#   apps/mobile/scripts/build-ios-release.sh              archive + export an .ipa (ios/App/build/export)
#   apps/mobile/scripts/build-ios-release.sh --upload     archive + upload straight to App Store Connect (TestFlight)
#   apps/mobile/scripts/build-ios-release.sh --unsigned   archive with signing off, to prove the project compiles
#
# Signing is automatic: with an App Store Connect API key, xcodebuild -allowProvisioningUpdates makes the distribution
# certificate and the App Store profile itself. Keys come from the environment, else ~/.config/duskbot/dusk.env:
#   APPLE_TEAM_ID          the 10 character team id (Membership details in the developer account)
#   APPLE_API_KEY_ID       App Store Connect API key id
#   APPLE_API_ISSUER       its issuer id
#   APPLE_API_KEY_PATH     the AuthKey_<id>.p8 file
# Without the API key it falls back to an "Apple Distribution" identity already in the login keychain plus Xcode's own
# signed-in account. The build number is DUSK_IOS_BUILD_NUMBER, default a timestamp (every upload needs a higher one).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mobile=$(cd "$here/.." && pwd)
repo=$(cd "$mobile/../.." && pwd)
project="$mobile/ios/App/App.xcodeproj"
out="$mobile/ios/App/build"
mode=export
case "${1:-}" in
  --check) mode=check ;; --upload) mode=upload ;; --unsigned) mode=unsigned ;; "") ;;
  *) echo "usage: $0 [--check|--upload|--unsigned]" >&2; exit 2 ;;
esac

. "$here/release-env.sh"
dusk_env_load APPLE_TEAM_ID APPLE_API_KEY_ID APPLE_API_ISSUER APPLE_API_KEY_PATH

problems=()
[ -n "${APPLE_TEAM_ID:-}" ] || problems+=("APPLE_TEAM_ID is not set (developer.apple.com, Account, Membership details, Team ID)")
api_key=no
if [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  if [ -f "$APPLE_API_KEY_PATH" ]; then api_key=yes
  else problems+=("APPLE_API_KEY_PATH points at a file that does not exist"); fi
fi
dist_identity=$(security find-identity -v -p codesigning 2>/dev/null | grep -c '"Apple Distribution' || true)
if [ "$api_key" = no ] && [ "$dist_identity" = 0 ]; then
  problems+=("no way to sign for the store: set APPLE_API_KEY_ID, APPLE_API_ISSUER and APPLE_API_KEY_PATH (App Store Connect, Users and Access, Integrations, Team Keys, role App Manager or Admin), or install an Apple Distribution certificate in the login keychain")
fi
if [ "$mode" = upload ] && [ "$api_key" = no ]; then
  problems+=("--upload needs the App Store Connect API key (APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_API_KEY_PATH)")
fi

echo "team id:              $([ -n "${APPLE_TEAM_ID:-}" ] && echo present || echo missing)"
echo "api key (auto sign):  $api_key"
echo "distribution certs:   $dist_identity in the keychain"
if [ "$mode" = check ]; then
  if [ ${#problems[@]} -eq 0 ]; then echo "ready to archive"; exit 0; fi
  printf 'missing: %s\n' "${problems[@]}" >&2; exit 1
fi
if [ "$mode" != unsigned ] && [ ${#problems[@]} -gt 0 ]; then
  printf 'error: %s\n' "${problems[@]}" >&2
  echo "nothing was built; see docs/store-launch.md, iOS signing" >&2
  exit 1
fi

build_number="${DUSK_IOS_BUILD_NUMBER:-$(date -u +%y%m%d%H%M)}"
cd "$repo"
echo "== web bundle"
pnpm --filter @duskbot/mobile build
echo "== release gate"
node apps/mobile/scripts/release-gate.mjs
echo "== cap sync ios"
(cd "$mobile" && npx cap sync ios)

mkdir -p "$out"
archive="$out/dusk-bot.xcarchive"
rm -rf "$archive"
auth=()
if [ "$api_key" = yes ]; then
  auth=(-allowProvisioningUpdates -authenticationKeyPath "$APPLE_API_KEY_PATH" -authenticationKeyID "$APPLE_API_KEY_ID" -authenticationKeyIssuerID "$APPLE_API_ISSUER")
elif [ "$mode" != unsigned ]; then
  auth=(-allowProvisioningUpdates)
fi

echo "== archive (build $build_number)"
if [ "$mode" = unsigned ]; then
  xcodebuild -quiet -project "$project" -scheme App -configuration Release -destination 'generic/platform=iOS' \
    -archivePath "$archive" CURRENT_PROJECT_VERSION="$build_number" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO archive
  echo "unsigned archive (cannot be uploaded): $archive"
  exit 0
fi
xcodebuild -quiet -project "$project" -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$archive" "${auth[@]}" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$build_number" archive

options="$out/ExportOptions.plist"
destination=export
[ "$mode" = upload ] && destination=upload
cat > "$options" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>$destination</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>testFlightInternalTestingOnly</key><false/>
</dict>
</plist>
PLIST

echo "== export ($destination)"
rm -rf "$out/export"
xcodebuild -quiet -exportArchive -archivePath "$archive" -exportOptionsPlist "$options" -exportPath "$out/export" "${auth[@]}"
if [ "$mode" = upload ]; then
  echo "uploaded build $build_number; it shows in App Store Connect, TestFlight once processing ends (5 to 30 minutes)"
else
  ls "$out/export"/*.ipa
fi
