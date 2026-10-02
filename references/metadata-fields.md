# Scraped book metadata fields

Each record in `.kdp-session/book-metadata.json`:

| Field | Source page |
|-------|-------------|
| `titleId`, `format` | Bookshelf |
| `title`, `subtitle`, `description` | Details |
| `keywords[]` (7) | Details |
| `categories[]` | Details |
| `seriesTitle`, `seriesNumber` | Details |
| `primaryAuthor`, `contributors` | Details |
| `language`, `readingInterestAgeMin/Max` | Details |
| `isPublicDomain`, `isAdultContent`, `largePrint` | Details |
| `asin`, `listPriceUsd`, `prices`, `territory` | Pricing |
| `trimSize`, `pageCount`, `interiorFileName` | Content |
| `bleed`, `manuscriptStatus`, `coverStatus` | Print content settings and asset readiness |
| `processingErrors[]`, `printPreviewerStatus` | KDP's preview availability response |
| `kdpSelect`, `royaltyPlan` | Pricing |
| `syncedAt` | Sync timestamp |

## KDP URLs (per format)

Current print content pages render a React shell. Metadata sync reads their authenticated
`/print-setup/print-book/{titleId}/{format}/en-US/v2/get-setup-page` JSON response,
with legacy HTML fallback when that endpoint returns 404/405. Authentication,
server errors, and unknown schemas fail explicitly rather than caching empty fields.

`npm run content:status -- TITLE_ID paperback --json` reads settings, uploaded filenames,
asset processing status, and reported failure codes without uploading or saving a book.
`INTERIOR_PROCESSING_FAILED` and `COVER_PROCESSING_FAILED` are generic backend failures,
not explanations of a specific PDF defect. Recorded page counts may come from an earlier
processing attempt; they do not prove the current asset succeeded. Successful assets keep
the existing `SUCCESS` status. Metadata cache version 3 adds these diagnostics while
normalizing older cache entries with safe defaults.

```
https://kdp.amazon.com/en_US/title-setup/{format}/{titleId}/details
https://kdp.amazon.com/en_US/title-setup/{format}/{titleId}/content
https://kdp.amazon.com/en_US/title-setup/{format}/{titleId}/pricing
```

## Keyword fields

- 7 backend keyword slots, max 50 chars each
- Amazon indexes title/subtitle words in search
