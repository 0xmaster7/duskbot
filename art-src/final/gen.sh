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

# the ending and the pricing sky: calm in the middle so the words read, clouds kept to the sides
e "Redraw this meadow scene as a wide 3:2 landscape with a much calmer sky: the whole upper two thirds is one single flat band of bright cyan sky blue with no band edges crossing it, then one slightly lighter band just above the hills. Exactly two flat pixel clouds, both at mid height and both touching the side edges of the picture: a white one with a lemon underside at the far left and a white one with a pink underside at the far right. The centre of the sky is completely empty. No sun. Keep the lilac hills, emerald trees and the pale lime meadow with drifts of small white, pink and lemon flowers in the lower third." end-meadow wide-meadow 1536x1024 &
e "Redraw this as a wide 3:2 picture of only sky, no land at all: bright cyan sky blue at the top, one slightly lighter band in the lower half, the two bands meeting in scattered pixels. Five small flat pixel clouds, white with pink or lemon undersides, placed only near the left edge, the right edge and the bottom corners. The centre is empty sky. No sun, no ground, no water." price-sky wide-layers 1536x1024 &
wait

# the sea behind the day's finished work: islands kept low so the cards sit on open sky
e "Redraw this scene as a wide 3:2 landscape. The upper two thirds is calm banded cyan sky with one small flat cloud with a pink underside touching the far left edge and one with a lemon underside touching the far right edge, no sun. In the lower third: the banded sea with four round green islands with cream sand edges spread wide apart, and scattered white pixel sparkles on the water." wide-islands r17-islands 1536x1024
