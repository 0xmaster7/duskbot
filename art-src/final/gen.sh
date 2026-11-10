#!/usr/bin/env bash
# the home page's wide pictures, each drawn from one of the chosen portrait posters so the technique stays identical
H=~/.claude/skills/gpt-image-mchat
K="Keep exactly the same rendering technique as this image: the same big square pixel blocks, the same bright pale pastel colours with lots of white, the same fine white woven micro-texture inside every block, the same banded sky that breaks into scattered pixels. Calm and simple, few big flat shapes. No buildings, no machines, no people, no animals, no text."
e() { [ -f "$2.png" ] || node $H/gen.mjs "$1 $K" "$2.png" --edit="$3.png" --size="$4" > "$2.log" 2>&1; }
e "Redraw this scene as a tall portrait 3:4 with a new sky: no sun at all, one long flat white cloud with a lemon underside at the upper right and one small white cloud with a pink underside at the middle left. Keep the snow peaks, lilac ridge, emerald forest and pale lime field." hero-peaks r01-snow-peaks 1024x1536 &
e "Redraw this scene as a wide 3:2 landscape. The upper two thirds is open banded sky with only two small flat clouds near the left and right edges, one with a pink underside and one with a lemon underside, and no sun. The layers (snow peaks, lilac ridge, emerald forest, green band, pale lime field) sit in the lower third." wide-layers r13-five-layers 1536x1024 &
e "Redraw this scene as a wide 3:2 landscape. The upper two thirds is open banded sky with one small pink-bellied cloud at the far left and a lemon sun at the far right. In the lower third: the banded sea with three cream-sailed boats spread wide apart, and a strip of pale sand along the bottom." wide-sails r04-sails 1536x1024 &
e "Redraw this scene as a wide 3:2 landscape. The upper half is open banded sky with one flat white cloud with a lemon underside at the upper left, no sun. The lower half is the pale lime meadow with loose drifts of small white, pink and lemon pixel flowers, and a thin band of emerald trees and pale lilac hills on the horizon. The very bottom edge is plain pale lime." wide-meadow r08-flower-drifts 1536x1024 &
wait
[ -f cat.png ] || node $H/gen.mjs "A sleeping orange and cream cat curled into a loaf, seen from the side, drawn as very low resolution chunky pixel art with big square pixel blocks, flat colours, no outlines, no shading, in bright pale pastel orange, cream and white with a pink nose; each block has a fine white woven micro-texture. Only the cat, isolated on a fully transparent background, no ground, no shadow, no text." cat.png --transparent > cat.log 2>&1

# small objects for the feature cards, in the same technique
T="Drawn as very low resolution chunky pixel art with big square pixel blocks, completely flat colours, no outlines, no shading, no gradients, in a bright pale pastel palette (sky blue, cotton-candy pink, lemon yellow, lilac, emerald, cream white, lime); every block is filled with a fine white woven micro-texture so it shimmers like fabric. One object only, centred, isolated on a fully transparent background, no ground, no shadow, no text, no letters, no faces."
s() { [ -f "$2.png" ] || node $H/gen.mjs "$1 $T" "$2.png" --transparent > "$2.log" 2>&1; }
s "A chunky cream-white retro desktop computer with a sky-blue screen showing a tiny green hill and a lemon sun, and one big white mouse pointer arrow with a dark blue edge overlapping the lower right corner of the screen." s-computer &
s "A round alarm clock in cotton-candy pink with two bells on top and a cream face with lemon hands, and a small tear-off calendar with a sky-blue header leaning against it." s-clock &
s "An open notebook with cream pages and a pink ribbon bookmark, three small sticky notes in lemon, lime and sky blue stuck on the pages, and a sky-blue pencil lying across." s-notebook &
s "A big round red emergency push button on a square lemon-yellow base, with a clear pale-blue safety cover flipped open above it." s-button &
s "A cream-white door with a large lilac padlock hanging on it and a lemon-yellow key beside it." s-lock &
s "A cotton-candy pink rotary telephone with a cream dial and a curly cord." s-phone &
wait
