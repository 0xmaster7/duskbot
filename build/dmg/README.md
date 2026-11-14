The macOS install window art is drawn in code by `build/dmg/render.mjs` around the `dmg.contents` icon centres in `build/electron-builder.yml`, from the shared pixel scene kit in `build/art/pixel-scene.mjs`. Run `node build/dmg/render.mjs` to rewrite `build/background.png` (600 x 392) and `build/background@2x.png`; electron-builder pairs them into a retina TIFF.

electron-builder 26.15.3 sets the Finder window frame, title bar included, to the background's size and ignores `dmg.window` when a background is set. Finder draws the background from the top of the content area, so only the top 360 pt show and the last 32 pt (the title bar's height on macOS 26 and later, 28 pt before) sit under the window edge. Keep that strip plain background.

There is no text in the art: a flat light neutral grey, the two icons and one pixel arrow between them, like a standard Mac install window.
