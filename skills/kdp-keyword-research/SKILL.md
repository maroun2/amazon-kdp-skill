---
name: kdp-keyword-research
description: Research Amazon KDP book keywords from Amazon autocomplete suggestions and score candidate titles against saved keyword rows.
---

# KDP Keyword Research

Existing keyword collection behavior remains unchanged. Title scoring is a separate, offline standard-library command; it never calls Amazon.

## Deterministic title scoring

`score_titles.py` treats each saved keyword row like a grep target. For every meaningful title word, it adds one point for each row containing normalized form. Duplicate title words count once per occurrence. `raw_score` is total points, `meaningful_word_count` is title word count after filtering, and `normalized_score` is `raw_score / meaningful_word_count` (zero when count is zero). Results sort by normalized score descending, then title ascending for deterministic ties.

Rules:

- Lowercase and tokenize letters, retaining internal apostrophes.
- Remove possessive `'s` and trailing possessive apostrophe (`children's` → `children`). Other contractions remain one token (`can't` → `can't`).
- Normalize only these forms: `learning`/`learns` → `learn`, `flying`/`flight` → `fly`, `tried`/`trying` → `try`.
- Filter only `the`, `a`, `an`, `and`, `of`, `to`. Words such as `who`, `fly`, and `again` remain meaningful.
- Read collector `.json`, Markdown keyword tables, or one-row-per-line `.txt` files.

## Usage

```bash
python3 skills/kdp-keyword-research/scripts/score_titles.py \
  --keywords keywords/unicorn-coloring-book-amazon-keywords.json \
  --title "Learning to Fly" \
  --title "Who Can Fly Again"
```

Use `--titles-file path.txt` for one title per line. Output is JSON with `title`, `raw_score`, `meaningful_word_count`, and `normalized_score`.
