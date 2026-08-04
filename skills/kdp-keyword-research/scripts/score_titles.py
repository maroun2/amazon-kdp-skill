#!/usr/bin/env python3
"""Score candidate titles against saved Amazon autocomplete keyword rows.

This module deliberately does no network access.  A score is the number of
keyword rows containing each meaningful title word, after deterministic
normalization.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Iterable

FILLER_WORDS = {"the", "a", "an", "and", "of", "to"}
INFLECTIONS = {
    "learning": "learn",
    "learns": "learn",
    "flying": "fly",
    "flight": "fly",
    "tried": "try",
    "trying": "try",
}
WORD_RE = re.compile(r"[a-z]+(?:'[a-z]+)?")


def normalize_word(word: str) -> str:
    """Normalize one word; only documented inflections are collapsed."""
    word = word.lower().replace("’", "'")
    if word.endswith("'s"):
        word = word[:-2]
    elif word.endswith("s'"):
        word = word[:-1]
    return INFLECTIONS.get(word, word)


def words(text: str) -> list[str]:
    text = text.lower().replace("’", "'")
    return [normalize_word(match.group()) for match in WORD_RE.finditer(text)]


def meaningful_title_words(title: str) -> list[str]:
    return [word for word in words(title) if word and word not in FILLER_WORDS]


def _keyword_strings(value: object) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _keyword_strings(item)
    elif isinstance(value, dict):
        if isinstance(value.get("keyword"), str):
            yield value["keyword"]
        elif isinstance(value.get("keywords"), (list, str)):
            yield from _keyword_strings(value["keywords"])


def read_keyword_rows(path: str | Path) -> list[str]:
    """Read keyword rows from collector JSON, Markdown, or one-word-per-line text."""
    source = Path(path)
    text = source.read_text(encoding="utf-8")
    if source.suffix.lower() == ".json":
        return list(_keyword_strings(json.loads(text)))

    rows: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        if line.startswith("|"):
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if cells and cells[0].lower() not in {"keyword", "keywords"} and not set(cells[0]) <= {"-", ":"}:
                rows.append(cells[0])
        elif source.suffix.lower() in {".txt", ".text"}:
            rows.append(line)
    return rows


def score_title(title: str, keyword_rows: Iterable[str]) -> dict[str, object]:
    """Return deterministic raw, count, and normalized scores for one title."""
    title_words = meaningful_title_words(title)
    normalized_rows = [set(words(row)) for row in keyword_rows]
    raw_score = sum(sum(word in row for row in normalized_rows) for word in title_words)
    count = len(title_words)
    return {
        "title": title,
        "raw_score": raw_score,
        "meaningful_word_count": count,
        "normalized_score": raw_score / count if count else 0.0,
    }


def score_titles(titles: Iterable[str], keyword_rows: Iterable[str]) -> list[dict[str, object]]:
    rows = list(keyword_rows)
    results = [score_title(title, rows) for title in titles]
    return sorted(results, key=lambda result: (-float(result["normalized_score"]), str(result["title"])))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Score titles against saved Amazon keyword rows.")
    parser.add_argument("--keywords", required=True, help="Saved keyword .json, .md, or .txt file")
    parser.add_argument("--title", action="append", default=[], help="Candidate title; repeat for variants")
    parser.add_argument("--titles-file", help="UTF-8 file with one candidate title per line")
    args = parser.parse_args(argv)
    titles = list(args.title)
    if args.titles_file:
        titles.extend(Path(args.titles_file).read_text(encoding="utf-8").splitlines())
    if not titles:
        parser.error("provide --title or --titles-file")
    json.dump(score_titles(titles, read_keyword_rows(args.keywords)), sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
