#!/usr/bin/env python3
"""Validate the 17-page indexing cohort before deployment or GSC submission."""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://freeaudiotrim.com"
CONFIG_PATH = ROOT / "automation" / "indexing-priority.json"


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.lang = ""
        self.title = ""
        self.h1_count = 0
        self.canonical = ""
        self.robots = ""
        self.description = ""
        self.links: list[str] = []
        self.json_ld: list[str] = []
        self._capture = ""
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        if tag == "html":
            self.lang = values.get("lang", "")
        elif tag == "title":
            self._capture, self._buffer = "title", []
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "meta":
            name = values.get("name", "").lower()
            if name == "robots":
                self.robots = values.get("content", "")
            elif name == "description":
                self.description = values.get("content", "")
        elif tag == "link" and "canonical" in values.get("rel", "").lower():
            self.canonical = values.get("href", "")
        elif tag == "a" and values.get("href"):
            self.links.append(values["href"])
        elif tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._capture, self._buffer = "json", []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self._capture == "title":
            self.title = " ".join("".join(self._buffer).split())
            self._capture = ""
        elif tag == "script" and self._capture == "json":
            self.json_ld.append("".join(self._buffer))
            self._capture = ""


def canonical_for(relative: str) -> str:
    return f"{BASE_URL}/{relative}"


def normalize_target(source: str, href: str) -> str | None:
    if href.startswith(("mailto:", "tel:", "javascript:", "#")):
        return None
    parsed = urlparse(href)
    if parsed.netloc and parsed.netloc != "freeaudiotrim.com":
        return None
    path = parsed.path
    if not path:
        return None
    if path == "/":
        return "index.html"
    if path.endswith("/"):
        path += "index.html"
    return path.lstrip("/")


def parse_page(relative: str) -> PageParser:
    parser = PageParser()
    parser.feed((ROOT / relative).read_text(encoding="utf-8"))
    return parser


def sitemap_paths() -> set[str]:
    namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    tree = ET.parse(ROOT / "sitemap.xml")
    paths = set()
    for node in tree.findall(".//s:loc", namespace):
        path = urlparse(node.text or "").path
        if path == "/":
            paths.add("index.html")
        elif path.endswith("/"):
            paths.add(f"{path.lstrip('/')}index.html")
        else:
            paths.add(path.lstrip("/"))
    return paths


def main() -> int:
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("--json", action="store_true", dest="json_output")
    args = argument_parser.parse_args()

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cohort: list[str] = config["pages"]
    sitemap = sitemap_paths()
    failures: dict[str, list[str]] = defaultdict(list)
    warnings: dict[str, list[str]] = defaultdict(list)
    parsed: dict[str, PageParser] = {}

    for relative in cohort:
        path = ROOT / relative
        if not path.exists():
            failures[relative].append("file missing")
            continue
        page = parsed[relative] = parse_page(relative)
        expected = canonical_for(relative)
        if relative not in sitemap:
            failures[relative].append("missing from sitemap")
        if "noindex" in page.robots.lower():
            failures[relative].append("robots contains noindex")
        if page.canonical != expected:
            failures[relative].append(f"canonical is {page.canonical or 'missing'}")
        if page.h1_count != 1:
            failures[relative].append(f"expected one H1, found {page.h1_count}")
        if not page.lang:
            failures[relative].append("html lang missing")
        if not page.title:
            failures[relative].append("title missing")
        elif not 30 <= len(page.title) <= 65:
            warnings[relative].append(f"title length {len(page.title)}")
        if not page.description:
            failures[relative].append("meta description missing")
        elif not 110 <= len(page.description) <= 170:
            warnings[relative].append(f"description length {len(page.description)}")
        for block in page.json_ld:
            try:
                json.loads(block)
            except json.JSONDecodeError as error:
                failures[relative].append(f"invalid JSON-LD: {error.msg}")

    inbound_sources: dict[str, set[str]] = defaultdict(set)
    for source_path in ROOT.rglob("*.html"):
        if any(part in {"node_modules", ".git"} for part in source_path.parts):
            continue
        source = source_path.relative_to(ROOT).as_posix()
        source_page = parse_page(source)
        for href in source_page.links:
            target = normalize_target(source, href)
            if target:
                inbound_sources[target].add(source)
    for relative in cohort:
        count = len(inbound_sources.get(relative, set()))
        if count < 2:
            failures[relative].append(f"only {count} unique internal link sources")

    for utility in config["excludedUtilities"]:
        page = parse_page(utility)
        if utility in sitemap:
            failures[utility].append("excluded utility appears in sitemap")
        if "noindex" not in page.robots.lower():
            failures[utility].append("excluded utility must remain noindex")

    result = {
        "cohortSize": len(cohort),
        "passed": len(cohort) - sum(bool(failures.get(page)) for page in cohort),
        "failures": failures,
        "warnings": warnings,
        "intentOwners": config["intentOwners"],
    }
    if args.json_output:
        print(json.dumps(result, indent=2, ensure_ascii=False, default=list))
    else:
        print(f"Indexing readiness: {result['passed']}/{len(cohort)} pages pass blocker gate")
        for relative in cohort:
            state = "PASS" if not failures.get(relative) else "FAIL"
            notes = "; ".join(failures.get(relative, []) + warnings.get(relative, []))
            print(f"{state:4} {relative}{': ' + notes if notes else ''}")
        if config["intentOwners"]:
            print("\nIntent ownership:")
            for page, intent in config["intentOwners"].items():
                print(f"- {page}: {intent}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
