#!/usr/bin/env python3
# writes a cursor theme whose every cursor is one transparent pixel: the desktop's own pointer never shows, so a viewer,
# a screenshot or a recording carries no pointer frozen where the person last left it. the app draws the bot's pointer.
import os
import pathlib
import struct
import sys

# the X core cursor font and the CSS names toolkits ask for first, so no lookup falls through to a visible glyph
NAMES = """
X_cursor arrow based_arrow_down based_arrow_up boat bogosity bottom_left_corner bottom_right_corner bottom_side bottom_tee
box_spiral center_ptr circle clock coffee_mug cross cross_reverse crosshair diamond_cross dot dotbox double_arrow
draft_large draft_small draped_box exchange fleur gobbler gumby hand1 hand2 heart icon iron_cross left_ptr left_side
left_tee leftbutton ll_angle lr_angle man middlebutton mouse pencil pirate plus question_arrow right_ptr right_side
right_tee rightbutton rtl_logo sailboat sb_down_arrow sb_h_double_arrow sb_left_arrow sb_right_arrow sb_up_arrow
sb_v_double_arrow shuttle sizing spider spraycan star target tcross top_left_arrow top_left_corner top_right_corner
top_side top_tee trek ul_angle umbrella ur_angle watch xterm
default pointer text vertical-text wait progress help context-menu cell crosshair copy alias move no-drop not-allowed
grab grabbing all-scroll col-resize row-resize n-resize e-resize s-resize w-resize ne-resize nw-resize se-resize sw-resize
ew-resize ns-resize nesw-resize nwse-resize zoom-in zoom-out dnd-none dnd-move dnd-copy dnd-link dnd-ask
""".split()

IMAGE = 0xFFFD0002


def blank_cursor(sizes=(24, 32, 48)):
    """An Xcursor file: one 1x1 fully transparent image per nominal size."""
    header = struct.pack("<4sIII", b"Xcur", 16, 0x10000, len(sizes))
    toc_end = 16 + 12 * len(sizes)
    chunk = lambda size: struct.pack("<IIIIIIIII", 36, IMAGE, size, 1, 1, 1, 0, 0, 0) + struct.pack("<I", 0)
    chunks = [chunk(size) for size in sizes]
    toc, offset = b"", toc_end
    for size, body in zip(sizes, chunks):
        toc += struct.pack("<III", IMAGE, size, offset)
        offset += len(body)
    return header + toc + b"".join(chunks)


def write_theme(source, theme):
    cursors = theme / "cursors"
    cursors.mkdir(parents=True, exist_ok=True)
    (theme / "index.theme").write_text("[Icon Theme]\nName=omb-hidden\nComment=No visible pointer\n")
    (cursors / "default").write_bytes(blank_cursor())
    names = set(NAMES) | ({entry.name for entry in source.iterdir()} if source.is_dir() else set())
    for name in sorted(names - {"default"}):
        os.symlink("default", cursors / name)


if __name__ == "__main__":
    write_theme(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
