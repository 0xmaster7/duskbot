# Dock icons

The three dock icons are rendered once at build time (`rsvg-convert`, 68 px, real alpha) and tint2 shows them at
34 px. Each file is a Papirus app icon (64x64 variant) with its drop-shadow layers removed (the low-opacity black
shapes offset 1 px down), so the icons sit flat on the wallpaper with no dark rim. Nothing else was changed.

| File | Papirus source | Shown for |
| --- | --- | --- |
| `browser.svg` | `64x64/apps/chromium-browser.svg` (Papirus's drawing of the Chromium logo) | Chromium |
| `tools.svg` | `64x64/apps/thunar.svg` | Thunar (files) |
| `terminal.svg` | `64x64/apps/utilities-terminal.svg` | xfce4-terminal |

Source: Papirus icon theme, Debian package `papirus-icon-theme` 20250501-1,
https://github.com/PapirusDevelopmentTeam/papirus-icon-theme

License: GPL-3.0 (Copyright 2016-2017 Alexey Varfolomeev, Sergei Eremenko, Papirus Development Team). The image also
installs the full `Papirus-Dark` theme from Debian for Thunar and GTK file dialogs, under the same license. The
image strips `/usr/share/doc` (the package's copyright file with it), so this file is the record. Shipping GPL-3 icons inside the image is fine; anyone redistributing the image must keep them
under GPL-3 (these SVGs are their own source).

The Chromium logo itself is BSD-licensed artwork from the Chromium project; "Chromium" is a name of the Chromium
project, used here only to label the bundled Chromium browser.
