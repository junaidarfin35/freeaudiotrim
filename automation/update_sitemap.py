#!/usr/bin/env python3

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Iterable
import difflib
from xml.sax.saxutils import escape


SITE_URL = "https://freeaudiotrim.com"
ROOT = Path(__file__).resolve().parent.parent
SITEMAP_PATH = ROOT / "sitemap.xml"
IGNORE_DIRS = {
    ".git",
    "_reports",
    "_tmp",
    "automation",
    "node_modules",
}


def iter_html_files() -> Iterable[Path]:
    for path in sorted(ROOT.rglob("*.html")):
        relative = path.relative_to(ROOT)
        if any(part in IGNORE_DIRS for part in relative.parts):
            continue
        yield path


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def parse_robots_meta(html: str) -> str:
    patterns = (
        r'<meta[^>]+name=["\']robots["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']robots["\']',
    )
    for pattern in patterns:
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ""


def is_indexable(path: Path) -> bool:
    robots = parse_robots_meta(read_text(path)).lower()
    return "noindex" not in robots


def url_for(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    if relative == "index.html":
        return f"{SITE_URL}/"
    if relative.endswith("/index.html"):
        return f"{SITE_URL}/{relative.rsplit('/', 1)[0]}/"
    return f"{SITE_URL}/{relative}"


def lastmod_for(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime).date().isoformat()


def build_xml(entries: list[tuple[str, str]]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ""]
    for url, lastmod in entries:
        lines.extend(
            [
                "  <url>",
                f"    <loc>{escape(url)}</loc>",
                f"    <lastmod>{lastmod}</lastmod>",
                "  </url>",
            ]
        )
    lines.extend(["", "</urlset>", ""])
    return "\n".join(lines)


def collect_entries() -> list[tuple[str, str]]:
    entries = []
    for path in iter_html_files():
        if not is_indexable(path):
            continue
        entries.append((url_for(path), lastmod_for(path)))
    return sorted(entries, key=lambda item: item[0])


def run_check(xml: str) -> int:
    existing = SITEMAP_PATH.read_text(encoding="utf-8") if SITEMAP_PATH.exists() else ""
    if existing == xml:
        print(f"Sitemap is up to date: {SITEMAP_PATH}")
        return 0

    print(f"Sitemap is out of date: {SITEMAP_PATH}")
    diff = difflib.unified_diff(
        existing.splitlines(),
        xml.splitlines(),
        fromfile="current sitemap.xml",
        tofile="expected sitemap.xml",
        lineterm="",
    )
    for line in diff:
        print(line)
    return 1


def main() -> int:
    entries = collect_entries()
    xml = build_xml(entries)
    if "--check" in sys.argv[1:]:
        return run_check(xml)
    SITEMAP_PATH.write_text(xml, encoding="utf-8")
    print(f"Updated {SITEMAP_PATH} with {len(entries)} URLs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
