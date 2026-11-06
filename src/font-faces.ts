import xvf from "./assets/fonts/xvf.woff2?url";
import xvfMono from "./assets/fonts/xvf-mono.woff2?url";
import grokIcons from "./assets/fonts/grok-icons.woff2?url";

// Registered from script rather than @font-face: Chromium reloads every stylesheet font when a stylesheet holding
// @font-face changes, as styles.css (with its fontsource faces) does on each Tailwind rebuild, and these faces' block
// period blanks all text and icons for that frame. Script faces are not reloaded.
const FACES: Array<[family: string, url: string, descriptors: FontFaceDescriptors]> = [
  // Grok's interface faces, xAI's own (X-VF and XMono-VF), copied from the Grok Bot app for this private fork. Not for
  // redistribution.
  ["XVF", xvf, { weight: "200 800", display: "fallback" }],
  ["XVF Mono", xvfMono, { weight: "200 800", display: "fallback" }],
  // grok bot's icon font (cursor-icons-16). third-party asset: private fork only
  ["Grok Icons", grokIcons, { display: "block" }],
];

if (typeof FontFace === "function" && typeof document !== "undefined" && document.fonts) {
  for (const [family, url, descriptors] of FACES) document.fonts.add(new FontFace(family, `url("${url}") format("woff2")`, descriptors));
}
