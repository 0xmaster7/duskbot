import "../../../electron/legacy-names.mjs";
import { Capacitor } from "@capacitor/core";
import { mountMobile } from "@/mobile/boot";
import { webPlatform } from "@/mobile/platform";
import { nativePlatform } from "./native-platform";

const platform = Capacitor.isNativePlatform() ? await nativePlatform() : webPlatform();
mountMobile(platform);
