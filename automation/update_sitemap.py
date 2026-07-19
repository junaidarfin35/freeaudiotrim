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
PAGES_SITEMAP_PATH = ROOT / "sitemap-pages.xml"
POSTS_SITEMAP_PATH = ROOT / "sitemap-posts.xml"
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


def build_sitemap_index(entries: list[tuple[str, str]]) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ""]
    for url, lastmod in entries:
        lines.extend(
            [
                "  <sitemap>",
                f"    <loc>{escape(url)}</loc>",
                f"    <lastmod>{lastmod}</lastmod>",
                "  </sitemap>",
            ]
        )
    lines.extend(["", "</sitemapindex>", ""])
    return "\n".join(lines)


def collect_entries() -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    pages = []
    posts = []
    for path in iter_html_files():
        if not is_indexable(path):
            continue
        relative = path.relative_to(ROOT).as_posix()
        entry = (url_for(path), lastmod_for(path))
        if relative.startswith("blog/") and relative != "blog/index.html":
            posts.append(entry)
        else:
            pages.append(entry)
    return (
        sorted(pages, key=lambda item: item[0]),
        sorted(posts, key=lambda item: item[0]),
    )


def latest_lastmod(entries: list[tuple[str, str]]) -> str:
    if not entries:
        return datetime.now().date().isoformat()
    return max(lastmod for _, lastmod in entries)


def build_outputs() -> dict[Path, str]:
    pages, posts = collect_entries()
    sitemap_index = build_sitemap_index(
        [
            (f"{SITE_URL}/sitemap-pages.xml", latest_lastmod(pages)),
            (f"{SITE_URL}/sitemap-posts.xml", latest_lastmod(posts)),
        ]
    )
    return {
        SITEMAP_PATH: sitemap_index,
        PAGES_SITEMAP_PATH: build_xml(pages),
        POSTS_SITEMAP_PATH: build_xml(posts),
    }


def run_check(outputs: dict[Path, str]) -> int:
    status = 0
    for path, xml in outputs.items():
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        if existing == xml:
            print(f"Sitemap is up to date: {path}")
            continue

        status = 1
        print(f"Sitemap is out of date: {path}")
        diff = difflib.unified_diff(
            existing.splitlines(),
            xml.splitlines(),
            fromfile=f"current {path.name}",
            tofile=f"expected {path.name}",
            lineterm="",
        )
        for line in diff:
            print(line)
    return status


def main() -> int:
    outputs = build_outputs()
    if "--check" in sys.argv[1:]:
        return run_check(outputs)
    for path, xml in outputs.items():
        path.write_text(xml, encoding="utf-8")
    pages, posts = collect_entries()
    print(f"Updated {SITEMAP_PATH} with 2 child sitemaps.")
    print(f"Updated {PAGES_SITEMAP_PATH} with {len(pages)} URLs.")
    print(f"Updated {POSTS_SITEMAP_PATH} with {len(posts)} URLs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
