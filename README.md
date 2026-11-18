# TriLine Studio (LangSub)

TriLine Studio converts single or dual movie/TV subtitle files (`.srt`, `.vtt`, `.ass`, `.ssa`) into synchronized three-line language-learning subtitles combining:

1. **Base language translation** (natural comprehension)
2. **Target language dialogue** (preserved original dialogue or natural adaptation)
3. **English-intuitive phonetics** (consistent, non-IPA pronunciation guide)

## Architecture

- **Frontend (`src/`)**: React 19 + TypeScript + Tailwind CSS v4 SPA served via Vite middleware in development and static `dist/` in production.
  - `Generator`: Three conversion modes (`target-first`, `base-first`, `dual-merge`), configurable translation styles (`natural`, `literal`, `colloquial`, `formal`), phonetic conventions (`hyphenated`, `flowing`, `standard` Romanization), encoding-aware parsing diagnostics, interactive `AlignmentInspector`, 16:9 `CinemaPreview` with collapsible `Learning Controls` (line toggles, word-level highlighting, playback speed, inter-cue pause, cue repeat/replay), and inline `CueEditorTable`.
  - `Movie Search`: TMDB catalog lookup + concurrent multi-provider subtitle search (`OpenSubtitles` and `SubDL`) with provider-grouped results, language/format filters, cross-provider deduplication, and independent provider retries.
  - `Saved Library`: Cached project browser with one-click reopen and `.SRT`/`.VTT`/`.ASS` export.
  - `Export & Style`: Visual ASS hierarchy controls, custom 3-line ordering, and `.SRT`/`.VTT`/`.ASS` downloads.
  - `Settings`: Server-side Integration Diagnostics (`Google Gemini AI`, `TMDB`, `OpenSubtitles`, `SubDL`) with configuration status, verification status, last successful check timestamps, safe error descriptions, and live `Test Connection` actions.
- **Backend (`server.ts`, `server/`)**: Express API server keeping all API credentials strictly server-side.
  - `server/subtitles/parser.ts`: Encoding detection (UTF-8 strict check, UTF-16LE/BE BOM & BOM-less, Windows-1252, Shift_JIS), SDH cleanup, multiline merging (including CJK spacing rules), overlap diagnostics, and duplicate detection.
  - `server/subtitles/aligner.ts`: Global timing offset estimation, 1-to-many / many-to-1 / unmatched cue preservation, split-sentence continuation hints, alignment quality auditing, and confidence scoring.
  - `server/ai/translator.ts`: Batched Gemini conversion with preceding/following cue context windows, cross-cue continuation hints, language- and script-specific phonological rules, strict JSON/non-IPA/non-Latin validation, retries, bilingual+phonetic glossary consistency, and line caching.
  - `server/subtitles/exporter.ts`: Timing-faithful `.SRT`, `.VTT` (WebVTT), and `.ASS` (v4.00+) export respecting custom 3-line ordering.
  - `server/providers/integrations.ts`: Fault-isolated TMDB, OpenSubtitles, SubDL, and Gemini integrations with explicit auth resolution, timeouts, secret redaction, result normalization, and deduplication.
  - `server/db/store.ts`: Atomic JSON persistence (`data/triline-db.json`), corrupt-file backup, job persistence, and startup recovery of interrupted jobs.

## Environment Variables

Configure secrets strictly in the server environment (`.env` locally or Secrets panel in production). Never expose API keys to the client.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes (for AI conversion) | Server-side Gemini API key (`@google/genai`). |
| `TMDB_READ_ACCESS_TOKEN` | Optional | Preferred TMDB v4 API Read Access Token (`Authorization: Bearer ...`). |
| `TMDB_V3_API_KEY` | Optional | Explicit TMDB v3 API key (`?api_key=...`). |
| `TMDB_API_KEY` | Optional | Backward-compatible TMDB key (v3 key by default, or v4 JWT fallback). |
| `OPENSUBTITLES_API_KEY` | Optional | OpenSubtitles REST API v1 key. |
| `OPENSUBTITLES_USER_AGENT` | Optional | User-Agent sent to OpenSubtitles (defaults to `TriLineStudio v1.0`). |
| `SUBDL_API_KEY` | Optional | SubDL subtitle search API key. |
| `APP_URL` | Optional | Hosted application URL. |
| `PORT` | Optional | Server port (defaults to `3000`). |
| `TRILINE_DB_PATH` | Optional | Override path for JSON persistence file. |

See `.env.example` for the template.

## Development & Verification

```bash
# Install dependencies
bun install --frozen-lockfile

# Run development server (Express + Vite middleware on port 3000)
npm run dev

# Run automated test suite (mocked provider responses, no live API keys needed)
bun test

# Run TypeScript type checks
npm run lint

# Build production frontend bundle
npm run build

# Run production server
npm start
```
