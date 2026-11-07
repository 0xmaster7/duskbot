#!/usr/bin/env python3
import os
import pathlib
import sys


def trim_icons(icons, applications):
    names = {"application-default-icon", "application-x-executable", "chromium", "folder", "org.xfce.Thunar", "system-file-manager", "thunar", "Thunar", "utilities-terminal", "xfce4-terminal"}
    for desktop in applications.rglob("*.desktop"):
        for line in desktop.read_text(errors="replace").splitlines():
            if line.startswith("Icon="):
                name = pathlib.Path(line[5:].strip()).name
                names.add(name[:-4] if name.endswith((".svg", ".png", ".xpm")) else name)

    candidates = set()
    for theme in ("Papirus", "Papirus-Dark"):
        for directory in (icons / theme).glob("*/apps"):
            if directory.is_symlink():
                continue
            directory = directory.resolve()
            candidates.update(path for path in directory.iterdir() if path.is_file() or path.is_symlink())
    keep = {path for path in candidates if path.stem in names}
    for theme in ("Papirus", "Papirus-Dark"):
        for path in (icons / theme).rglob("*"):
            if path.is_symlink() and path.parent.resolve() / path.name not in candidates:
                target = pathlib.Path(os.path.normpath(path.parent.resolve() / os.readlink(path)))
                if target in candidates:
                    keep.add(target)
    pending = list(keep)
    while pending:
        path = pending.pop()
        if not path.is_symlink():
            continue
        target = pathlib.Path(os.path.normpath(path.parent / os.readlink(path)))
        if target in candidates and target not in keep:
            keep.add(target)
            pending.append(target)
    removed = 0
    for path in candidates - keep:
        path.unlink()
        removed += 1
    print(f"trimmed {removed} unused application icons; kept installed app icons and their targets")


if __name__ == "__main__":
    trim_icons(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
