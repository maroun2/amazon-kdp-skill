---
name: amazon-kdp-upload-content
description: Uploads interior PDF or cover file to Amazon KDP title-setup content page. Use when replacing manuscript, cover, or updating print files.
disable-model-invocation: true
---

# KDP Upload Content

Uploads files to the **content** page for an existing title.

## Dry run (verify file input exists)

```bash
curl -X POST http://localhost:3001/api/kdp/content/upload \
  -H 'Content-Type: application/json' \
  -d '{
    "titleId": "YOUR_TITLE_ID",
    "format": "paperback",
    "fileType": "interior",
    "filePath": "/absolute/path/to/manuscript.pdf",
    "dryRun": true
  }'
```

## Upload

Set `"dryRun": false`. File must exist on disk.

```bash
curl -X POST http://localhost:3001/api/kdp/content/upload \
  -H 'Content-Type: application/json' \
  -d '{
    "titleId": "YOUR_TITLE_ID",
    "format": "paperback",
    "fileType": "cover",
    "filePath": "/absolute/path/to/cover.pdf",
    "dryRun": false
  }'
```

## fileType

- `interior` — manuscript PDF
- `cover` — cover PDF

## API

| Method | Path |
|--------|------|
| POST | `/api/kdp/content/upload` |
| POST | `/api/kdp/content/upload/batch` |

**Agents:** Upload interior and/or cover for **one title at a time**. Complete and verify each upload before the next title. Do not use the batch endpoint or parallel uploads.

Upload processing can take 1–2 minutes. The flow waits for upload confirmation then saves.

## Current print content page

For modern React print setup, use `npm run upload:print-content -- /absolute/spec.json --dry-run`, then same command without `--dry-run`. The CLI uses current upload buttons, requires expected print settings, uploads one PDF and saves draft. It never approves preview or publishes. On headless Linux it starts a private Xvfb display for headful Chromium; install Xvfb if missing. Saved Amazon session still comes from login:remote.

```json
{
  "titleId": "YOUR_TITLE_ID",
  "format": "paperback",
  "fileType": "interior",
  "filePath": "/absolute/manuscript.pdf",
  "expected": {
    "trimSize": "8x10",
    "bleed": true,
    "inkAndPaper": "Premium color interior, white paper",
    "coverFinish": "GLOSSY",
    "hasPublisherBarcode": false
  }
}
```

Optional `aiImages` is exact visible disclosure option; change it only from verified project facts. `confirmAiDisclosure: true` confirms current disclosure after checking every answer. No disclosure values are invented by default.

Upload/save HTTP 200 and persisted filename prove file transfer, not PDF acceptance. Run `npm run content:status -- TITLE_ID paperback --json` afterward. `NOT_READY` / `*_PROCESSING_NOT_COMPLETED` is pending; `FAILED` is failure. No blind retry loops. Unknown forms, CAPTCHA, settings mismatch or auth prompts stop without writing. Legacy REST endpoint still targets legacy forms.

Verified on 2026-10-02: one 90-page English interior and one matching cover transferred with HTTP 200, draft saves returned HTTP 200, and both filenames persisted. KDP processing remained pending; acceptance was not claimed. Regression tests cover reversed modern file-input order and metadata verification failures.
