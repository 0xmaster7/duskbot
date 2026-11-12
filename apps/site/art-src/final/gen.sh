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
s "A simple modern flat desktop monitor on a slim stand with a low keyboard in front of it, cream-white frame, a plain sky-blue screen with one white mouse pointer arrow in the middle. Very simple, very few details." s-computer &
s "A simple modern open laptop seen straight from the front, cream-white body, a plain sky-blue screen with a small deep-blue notch at the top centre of the screen, and just below the notch a small white pill holding three square dots in orange, blue and green. Very simple, very few details." s-notch &
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

# objects for the "pick where your bots live" cards, option b (the laptop there is s-notch)
s "A small squat home server box seen straight from the front, wider than tall, cream-white body with a lilac top edge and two short cream feet. Its front is one plain flat cream panel with a single thin sky-blue horizontal slot line near the bottom and nothing else on it: no lights, no buttons, no screen. Very simple, very few details." s-server &
s "One single wide flat cloud, cream-white on top with a cotton-candy pink underside along its whole bottom edge, three soft stepped bumps on top with the middle bump lowest so there is a shallow dip in the centre. Wide and low, about twice as wide as tall. Very simple, very few details." s-cloud &
wait

# the "every screen" scene: four plain devices whose empty sky-blue screens get the same flat bot on top, in the page
s "A simple modern open laptop seen straight from the front, cream-white body and keyboard deck with a few pastel keys, a large plain flat sky-blue screen with nothing at all on it: no notch, no icons, no pointer. Very simple, very few details." d-laptop &
s "A simple modern wide flat desktop monitor on a slim cream stand with a flat foot, thin cream-white frame, a large plain flat sky-blue screen with nothing at all on it: no icons, no pointer. No keyboard. Very simple, very few details." d-monitor &
wait
s "A simple modern smartphone standing upright, seen straight from the front, tall with rounded corners, a cotton-candy pink frame, a large plain flat sky-blue screen with nothing on it except one small dark pill near the top centre. Very simple, very few details." d-phone-a &
s "A simple modern smartphone standing upright, seen straight from the front, tall with rounded corners, a lilac frame, a large plain flat sky-blue screen with nothing on it except one small round dark camera dot at the top centre. Very simple, very few details." d-phone-b &
wait

# the rest of the site (docs, download, pricing, about, contact, brand, 404): wide strips for the page headers, each from a
# portrait poster that the home page does not use, and a few small objects. run just this part with: sh gen-site.sh
site() {
e "Redraw this scene as a wide 3:2 landscape. The upper half is open banded sky with one small flat white cloud with a pink underside near the right edge, and no sun. In the lower half: the pale lilac hills, the emerald forest with the tall thin cream birch trunks spread evenly across the whole width, and the pale lime field along the bottom." wide-birches r03-birches 1536x1024 &
e "Redraw this scene as a wide 3:2 landscape. The upper half is open banded sky with one long flat white cloud with a lemon underside at the upper right, and no sun. In the lower half: the white chalk cliffs with green tops stepping down from the left edge toward the middle, and the calm banded pale sea across the right side and along the bottom." wide-cliffs r05-white-cliffs 1536x1024 &
wait
e "Redraw this scene as a wide 3:2 landscape. The upper half is open banded sky with two thin flat white clouds with lemon undersides near the left and right edges, and no sun. In the lower half: a thin band of pale sea on the horizon, then soft cream sand dunes rolling across the whole width with three small tufts of green grass spread wide apart." wide-dunes r09-dunes 1536x1024 &
e "Redraw this scene as a wide 3:2 landscape of a calm pond. The upper half is open banded sky with one small flat white cloud with a pink underside at the far left, and no sun. In the lower half: a thin band of emerald trees on the horizon, then calm banded pale blue water with six round flat green lily pads spread wide apart, three of them carrying one small pink or white pixel flower, and a few cream reeds at the far left and far right edges." wide-pond r17-islands 1536x1024 &
wait
e "Redraw this scene as a wide 3:2 landscape. The upper half is open banded sky with one small flat white cloud with a pink underside at the far right, and no sun. In the lower half: the white chalk cliffs with green tops across the left two thirds, and in the middle of the cliffs one wide pale sky-blue waterfall falling straight down in stepped pixel bands into the calm banded pale sea along the bottom, with white pixel foam where it lands." wide-falls r05-white-cliffs 1536x1024 &
s "A parcel box in cream white tied with a sky-blue ribbon and a bow on top, with a small lemon-yellow tag hanging from the bow. Very simple, very few details." s-parcel &
wait
s "A cotton-candy pink mailbox on a short cream post, its little lemon-yellow flag raised, with one cream envelope sticking out of its slot. Very simple, very few details." s-mailbox &
s "A cream wooden signpost with two blank arrow boards pointing in opposite directions, the upper one sky blue and the lower one cotton-candy pink, and a small tuft of green grass at its foot. Very simple, very few details." s-signpost &
wait
s "A big lemon-yellow old-fashioned key with a round bow, lying at a slight angle, with a small lilac paper tag tied to it by a pink string. Very simple, very few details." s-key &
s "A cream painter's palette with six round blobs of paint in sky blue, orange, purple, pink, green and yellow, and one paintbrush with a cream handle lying across it. Very simple, very few details." s-palette &
wait
s "Two closed books stacked flat, seen from the front at a slight angle: a thick sky-blue book with a pink ribbon bookmark sticking out, and a thinner lemon-yellow book on top. Very simple, very few details." s-books &
s "A folded paper map opened flat, cream with pale green and sky-blue patches, one dotted pink path across it and a small pink round-headed pin at the end of the path. Very simple, very few details." s-map &
wait
e "Redraw this scene as a wide 3:2 landscape of an almost empty sea. The upper half is open banded sky with one small flat white cloud with a lemon underside at the far left, and no sun. In the lower half: calm banded pale blue sea across the whole width with scattered white pixel sparkles, completely empty except for one single very small round green island with a cream sand edge, a little right of the centre." wide-lost r17-islands 1536x1024 &
s "A cream-white power plug with two prongs and a curly sky-blue cable, next to a small lilac wall socket plate. Very simple, very few details." s-plug &
s "A small stack of three round flat coins in lemon yellow beside a cotton-candy pink coin purse with a cream clasp. Very simple, very few details." s-coins &
wait
}
