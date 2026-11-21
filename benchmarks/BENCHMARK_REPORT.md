# LangSub1 — Phase 4A Real-World Subtitle Quality Benchmark Report

**Date**: 2026-11-19  
**Pipeline Evaluated**: LangSub (TriLine Studio) — Express backend + `server/subtitles/parser.ts` + `server/subtitles/aligner.ts` + `server/ai/translator.ts` (`gemini-4-hydrogen`, `ThinkingLevel.LOW`)  
**Dataset**: `/benchmarks/dataset.ts` (4 original CC0 screenplay-style dialogue scenes in German, French, Japanese, and Korean — 12 cues each — plus 4 dual-subtitle alignment stress scenarios)  
**Runner**: `/benchmarks/runBenchmark.ts`

---

## 1. Scoring Rubric & Methodology Limitations

### Scoring Scale (1–5)
- **5 / 5 (Production-Ready)**: Accurate, natural, learner-ready output with zero blocking issues.
- **4 / 5 (Good with Minor Friction)**: Useful to learners overall; isolated minor phrasing, stress, or consistency imperfections.
- **3 / 5 (Usable but Noticeable Defects)**: Meaning generally intact, but contains misleading pronunciations, style/register slips, or awkward split-cue artifacts that hurt learning.
- **2 / 5 (Degraded)**: Frequent phonetic/translation inaccuracies or misleading guidance that actively confuses beginners.
- **1 / 5 (Broken)**: Catastrophic failure (e.g., off-by-one cue misalignment or unreadable/empty output).

### Honest Scope & Limitations
1. **What was automated**:
   - SRT parsing, cue count preservation, exact original dialogue preservation (`100%`), exact timestamp preservation (`100%`), non-empty 3-line checks, and deterministic alignment accuracy against ground-truth mappings (27 expected target cue associations + unmatched base cue tracking + 45-minute PAL/NTSC framerate drift regression test).
2. **What was evaluated from live Gemini outputs (AI-assisted linguistic audit)**:
   - **13 complete live `gemini-4-hydrogen` conversion runs (156 generated tri-line cues)** were executed through the real `/api/jobs/convert` pipeline:
     - All **4 languages** (German, French, Japanese, Korean) × all **3 conversion modes** (`target-first`, `base-first`, `dual-merge`) in `natural` + `hyphenated` style (12 runs = 144 cues).
     - `fr-bistro` in `target-first` + `formal` + `hyphenated` (1 run = 12 cues, allowing direct live `natural` vs. `formal` comparison).
   - Every cue in all 13 completed live runs was inspected line-by-line by the coding agent (AI linguistic review) for meaning accuracy, contextual disambiguation, idiom handling, split-sentence coherence, beginner English phonetic readability, phonological assimilation, and recurring-name consistency.
3. **What was NOT verified (unverified / quota-limited)**:
   - **No independent human native-speaker review was performed.** Scores reflect automated metrics plus AI linguistic inspection of real generated outputs; native-speaker ear tests with English-speaking beginners remain required before claiming human-validated pronunciation scores.
   - **Free-tier daily quota hit after 13 live runs**: The configured `GEMINI_API_KEY` hit the Google AI Free Tier daily limit (`20` requests/day on `gemini-4-hydrogen`, `429 RESOURCE_EXHAUSTED`) during the translation-style batch. Consequently:
     - Live outputs for `literal` and `colloquial` styles (all 4 languages), `formal` for German/Japanese/Korean, and `standard` phonetic mode were **not** completed live.
     - Post-fix live re-runs of the updated v4 phonetic prompts could **not** be executed against Gemini until the daily quota resets; the prompt fixes and diacritic-leak validator were verified via deterministic unit/regression tests instead.

---

## 2. Benchmark Dataset Summary

All 4 language scenes (`de-station`, `fr-bistro`, `ja-rain`, `ko-seoul`) contain 12 cues covering all 9 required dialogue types:
- **Contextual ambiguity**: German *Schloss* (lock vs. castle), French *avocat* (lawyer vs. avocado), Japanese *橋* vs. *端* (bridge vs. edge), Korean *배* (boat vs. pear).
- **Idioms & slang**: *auf den Keks gehen*, *Schwamm drüber*, *Echt jetzt?*; *ras-le-bol*, *tombe à l'eau*, *Bah oui !*; *マジで？*, *腹が立つじゃん*, *水に流そう*; *눈치가 없다*, *발 없는 말이 천 리 간다*.
- **Contractions / spoken reductions**: *hab's*, *geht's*; *J'sais pas*, *t'as*, *T'inquiète pas*; *忘れちゃった*, *じゃなかったんだ*; *뭐해*, *넌*, *게*.
- **Long split sentences** (cues #7–#8 in every language), **rapid short responses** (<700ms cues #4–#5), **recurring proper nouns** (*Lukas*, *München*, *Camille*, *Monsieur Moreau*, *Lyon*, *健太*, *新宿*, *민준*, *부산*), **formal register** (cue #9: *Sie*, *vous*, *keigo*, *합쇼체*), and **emotional dialogue** (cue #10).

---

## 3. Live Conversion Benchmark Matrix (13 Completed Live Runs)

| Sample | Language | Mode | Style | Orig / Timing Preserved | Translation Quality (AI Audit) | Phonetic Quality (AI Audit) | Alignment Quality | Severity of Top Issue | Recommended Correction |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| `de-station` | German | `target-first` | `natural` / `hyphenated` | 100% / 100% | **4.5 / 5** | **3.0 / 5** | N/A | **High** | Replace `ue`/`oe` (`MUEN-khen`, `tuer`) & `ei="eye"` (`gleys`, `leyet`) with English-readable `MEWN-khen`, `tewr`, `glice`, `lyte`. |
| `de-station` | German | `base-first` | `natural` / `hyphenated` | 100% / 100% | **4.5 / 5** | **2.5 / 5** | N/A | **High** | **Fixed**: Reject raw umlauts (`tüer`, `MÜN-khen`, `DRÜ-ber`, `TSOO-hörst`) in English-intuitive phonetic modes. |
| `de-station` | German | `dual-merge` | `natural` / `hyphenated` | 100% / 100% | **5.0 / 5** *(preserved)* | **3.0 / 5** | **5.0 / 5** *(paired)* | **Medium** | Fix `Tür` -> `teer` (flattened `ü`) & `leyet`/`gleyes`; standardize `schon` -> `shohn`. |
| `fr-bistro` | French | `target-first` | `natural` / `hyphenated` | 100% / 100% | **4.8 / 5** | **4.0 / 5** | N/A | **Medium** | **Fixed in prompt**: `travail` rendered as `tra-VAY` (rhymes with "say") instead of `tra-VIGH`/`tra-VY`. |
| `fr-bistro` | French | `base-first` | `natural` / `hyphenated` | 100% / 50–100%* | **4.5 / 5** | **3.5 / 5** | N/A | **Medium** | **Fixed in prompt**: `cabinet` -> `ka-bee-NAY` (should be `NEH`); `tombe à` -> `toh(m)-buh a` (missing elision). |
| `fr-bistro` | French | `dual-merge` | `natural` / `hyphenated` | 100% / 100% | **5.0 / 5** *(preserved)* | **4.3 / 5** | **5.0 / 5** *(paired)* | **Low** | Best French phonetic run (`tra-VIGH`, `ka-bee-NEH`, `mo-ROH`); minor stress inconsistency on short cues. |
| `fr-bistro` | French | `target-first` | `formal` / `hyphenated` | 100% / 100% | **4.7 / 5** | **4.0 / 5** | N/A | **Medium** | Distinct formal register vs. `natural` ("do not", "of course", "grant us"); still produced `tra-VAY`. |
| `ja-rain` | Japanese | `target-first` | `natural` / `hyphenated` | 100% / 100% | **4.5 / 5** | **4.0 / 5** | N/A | **Medium** | Good kanji/particle readings (`は -> wah`, `を -> oh`, `masu -> mahss`); minor long-chain hyphenation (`toh-doh-keh-rah-reh-nah-KAHT-tah-rah`). |
| `ja-rain` | Japanese | `base-first` | `natural` / `hyphenated` | 100% / 100% | **3.5 / 5** | **3.5 / 5** | N/A | **Medium** | Split cue #7–#8 SOV clause mismatch: cue #7 dropped `"If we can't deliver"` and shifted it into cue #8 (`この荷物を` / `夕方までに届けられなかったら…`). |
| `ja-rain` | Japanese | `dual-merge` | `natural` / `hyphenated` | 100% / 100% | **5.0 / 5** *(preserved)* | **3.0 / 5** | **5.0 / 5** *(paired)* | **High** | **Fixed in prompt**: Over-hyphenated particles onto words (`tah-kah-hah-shee-SAH-mah-wah`, `ee-rahsh-shah-ee-MAHSS-deh-shoh-kah`), hurting readability and word highlighting. |
| `ko-seoul` | Korean | `target-first` | `natural` / `hyphenated` | 100% / 100% | **4.7 / 5** | **4.3 / 5** | N/A | **Low** | Strong assimilation (`muhng-NEUN`, `chuhl-LEE`, `sheel-LYEH-hahm-nee-dah`, `hwah-GEE-neh`); minor name drift (`min-JOO-na` vs `min-JOO-nah`). |
| `ko-seoul` | Korean | `base-first` | `natural` / `hyphenated` | 100% / 100% | **4.3 / 5** | **2.5 / 5** | N/A | **High** | **Fixed in prompt**: Slipped into Revised Romanization (`eo`/`yeo`/`ae`: `eop-KKU-na`, `seo-RYU`, `geu-REON`, `il-bu-REO`), opaque to English beginners. |
| `ko-seoul` | Korean | `dual-merge` | `natural` / `hyphenated` | 100% / 100% | **5.0 / 5** *(preserved)* | **3.5 / 5** | **5.0 / 5** *(paired)* | **Medium** | **Fixed in prompt**: Missed lateralization (`천 리` -> `chuhn ree` instead of `chuhl-LEE`) and liaison (`확인해` -> `hwa-GEEN-heh`). |

*\*All 13 completed live runs achieved 100.0% cue count preservation, 100.0% original-dialogue preservation, 100.0% timestamp preservation, and 100.0% non-empty 3-line completion.*

---

## 4. Detailed Findings & Concrete Failure Examples

### A. Alignment & Timing Benchmark (Before vs. After Fix)

| Scenario | Language | Before Fix (Accuracy / Est. Offset) | After Fix (Accuracy / Est. Offset) | Timing Preserved | Unmatched Base Preserved | Severity |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `align-constant-offset-split-merge` (+1.8s offset, 1:many, many:1, short replies, missing cues) | German | 8/8 (**100%**) / `+1800ms` | 8/8 (**100%**) / `+1800ms` | 100% | Yes | None |
| `align-progressive-drift` (23.976fps vs 25fps, 0ms → +2.8s drift) | Japanese | **0/8 (0%)** / **`-8800ms`** | **8/8 (100%)** / `+1400ms` (scale `1.0417`) | 100% | Yes *(was No)* | **Critical (Fixed)** |
| `align-overlapping-fast` (overlapping dual speakers + <700ms replies + jitter) | French | 6/6 (**100%**) / `-200ms` | 6/6 (**100%**) / `0ms` | 100% | Yes | None |
| `align-korean-unsplit-many-to-one` (comma-split English over 2 Korean cues + rapid replies) | Korean | 5/5 (**100%**) / `0ms` | 5/5 (**100%**) / `0ms` | 100% | Yes | None |
| *Regression*: 45-min PAL 25fps ↔ NTSC 23.976fps (~115s drift) | German/English | *(Broken: >60s drift)* | **30/30 (100%)** (scale `1.0427`) | 100% | Yes | **Critical (Fixed)** |

#### Concrete Alignment Failure Example (Before Fix — `align-progressive-drift`)
- **Cause**: Constant-offset-only histogram dispersed drifting pairs across bins, allowing an off-by-one alias at `-8800ms` to win. Additionally, clamping negative shifted timestamps crushed unmatched base cue #1 (`[2000–4500]`) to a 1ms stub `[0–1]`.
- **Before (Broken)**:
  - Cue #1 `[00:00:00.000–00:00:00.001]` (`unmatched-base`): `"" <=> "Kenta, did you already cross that bridge from earlier?"`
  - Cue #2 `[00:00:02.000–00:00:04.500]` (`exact`, conf `0.61`): `"健太、さっきの橋はもう渡った？" <=> "The old bridge in Shinjuku!"` *(Wrong cue!)*
  - Cue #4 `[00:00:22.000–00:00:24.500]` (`exact`, conf **`0.97`**): `"もし今日の夕方までにこの荷物を" <=> "we'll lose their trust."` *(High-confidence false match!)*
- **After (Fixed via `estimateGlobalTimeTransform`)**:
  - All 8/8 cues matched to exact counterparts (`scale ≈ 1.0417`), 0 false matches, 100% timing preserved, and cue durations preserved whenever clamping near `0`.

### B. Phonetic Quality Audit (Real Generated Examples)
1. **German — Raw Umlauts & Unreadable `ei` Substitutions (High Severity)**
   - *Observed (`base-first`)*: `München` → **`MÜN-khen`**, `drüber` → **`DRÜ-ber`**, `Tür` → **`tüer`**, `zuhörst` → **`TSOO-hörst`**.
   - *Observed (`target-first` / `dual-merge`)*: `Gleis` → **`gleys`** / **`gleyes`**, `leid` → **`leyet`**, `Tür` → **`teer`** (flattens `ü` to `ee`), `München` → **`MUEN-khen`** (German ASCII fallback, misread by English speakers).
   - *Fix Applied*: Added `INTUITIVE_DIACRITIC_FORBIDDEN_REGEX` validation (rejecting leaked `ü/ö/ä/ß/é/ç/ñ` in `hyphenated`/`flowing` modes so batches automatically retry) and updated German phonetic rules (`ü -> ew`, `ö -> eu`, `ä -> eh`, `ei -> y/igh` such as `glice`/`lyte`/`SHNY-der`, `schon -> shohn`, `ge- -> guh-`).
2. **Korean — Revised Romanization Leakage & Missed Assimilation (High Severity)**
   - *Observed (`base-first`)*: `없구나` → **`eop-KKU-na`**, `서류` → **`seo-RYU`**, `그런` → **`geu-REON`**, `일부러` → **`il-bu-REO`** (Revised Romanization `eo`/`yeo` is unintuitive for English beginners).
   - *Observed (`dual-merge`)*: `천 리` → **`chuhn ree`** (missed lateralization `chuhl-LEE`); `확인해` → **`hwa-GEEN-heh`** (missed liaison `hwah-GEE-neh`).
   - *Observed (`target-first`)*: `민준아` drifted between `min-JOO-na` (#1, #6) and `min-JOO-nah` (#11) within the same 12-cue batch.
   - *Fix Applied*: Updated Korean phonetic rules to explicitly forbid `eo`/`yeo`/`ae`/`oe` in English-intuitive modes, mandate concrete assimilation patterns (`chuhl-LEE`, `muhng-NEUN`, `hwah-GEE-neh`, `uhp-TTAH`), and enforce identical recurring-name spelling.
3. **Japanese — Giant Particle Hyphen Chains (High Severity)**
   - *Observed (`dual-merge`)*: `高橋様はいらっしゃいますでしょうか。` → **`tah-kah-hah-shee-SAH-mah-wah ee-rahsh-shah-ee-MAHSS-deh-shoh-kah.`** — gluing particles onto words breaks readability and breaks Cinema Preview's word-by-word highlighter.
   - *Fix Applied*: Updated Japanese phonetic rules to keep grammatical particles (`wah`, `gah`, `oh`, `noh`, `nee`, `deh`, `toh`, `yah`) space-separated from content words.
4. **French — Misleading `-ail` and `-et` Vowel Approximations (Medium Severity)**
   - *Observed (`target-first`/`base-first`/`formal`)*: `travail` → **`tra-VAY`** (reads like English "vay/say" instead of "vye/vigh"); `cabinet` → **`ka-bee-NAY`** (`base-first`); `tombe à` → **`toh(m)-buh a`** (failed elision).
   - *Fix Applied*: Updated French phonetic rules with explicit examples (`travail -> tra-VIGH`, `cabinet -> ka-bee-NEH`, `tombe à l'eau -> toh(m)b ah LOH`, `Moreau -> mo-ROH`).

### C. Translation Quality & Style Evaluation
- **Strengths observed across live runs**:
  - Contextual disambiguation succeeded across **all 4 languages**: German *Schloss* → `"lock"` (with cue #2 contrasting `"door or the building/castle"`), French *avocat* → `"lawyer"`, Japanese *橋* → `"bridge"` vs *端っこ* → `"edge"`, Korean *배* → `"boat"` vs `"pear"`.
  - Idioms were translated idiomatically rather than literally: *auf den Keks gehen* → `"getting on my nerves"`, *Schwamm drüber* → `"Forget about it"`, *ras-le-bol* → `"sick and tired"`, *tombe à l'eau* → `"goes down the drain"`, *水に流そう* → `"let bygones be bygones"`, *눈치가 없다* → `"have no clue"`, *발 없는 말이 천 리 간다* → `"Word travels fast"`.
  - **Live `natural` vs. `formal` comparison (`fr-bistro`)**: Clearly distinct without losing meaning (`"don't know where your head is at"` vs. `"do not know where your head is"`; `"Well, yeah!"` vs. `"Well, yes!"`; `"could you spare us"` vs. `"could you grant us"`; `"I'm begging you"` vs. `"I beg you"`).
- **Remaining translation weakness (not yet fixed — requires structural prompt/UI study)**:
  - In `base-first` Japanese (`ja-rain`), English SVO → Japanese SOV word-order inversion across split cues (#7–#8) caused cue #7 (`"If we can't deliver this package"`) to output only `この荷物を` ("this package"), pushing the entire verb/conditional clause into cue #8. This is an inherent cross-typological challenge when translating English subtitles into SOV languages (Japanese/Korean) per cue without merging cues.

### D. Operational Defect Found During Benchmarking
- **Daily quota retry storm & raw JSON error dump (Medium Severity — Fixed)**:
  - When Free Tier daily quota (`20` RPD on `gemini-4-hydrogen`) was exhausted, `callGeminiBatchWithRetry()` retried each batch 3 times and exposed a 1,100-character raw JSON stack in `job.error`.
  - *Fix Applied*: `isNonRetryableApiError()` now detects daily quota exhaustion (`RESOURCE_EXHAUSTED` + `PerDay` / `requests per day`) to fail fast on attempt #1, and `formatGeminiErrorMessage()` extracts a concise, user-readable message.

---

## 5. Next Priorities (Post-Phase 4A)
1. **Re-run the live benchmark after quota reset (or with a paid/higher-quota key)** to empirically verify the v4 phonetic prompt improvements on live `gemini-4-hydrogen` outputs and complete live runs for `literal`, `colloquial`, remaining `formal`, and `standard` phonetic modes.
2. **Human native-speaker + learner spot-check**: Have English-speaking learners read 20–30 generated cues aloud across German, French, Japanese, and Korean alongside native audio to calibrate stress capitalization and vowel digraph conventions (especially Japanese pitch-accent vs. English stress caps, and Korean `eu`/`어`).
3. **SOV split-cue guidance for `base-first` mode**: Investigate optional split-clause balance hints when translating English SVO split cues into Japanese/Korean SOV cues so one cue is not reduced to a 3-character noun fragment while the next overflows.
4. **Adaptive batch sizing for long films**: At `BATCH_SIZE = 20`, a 1,000-cue movie requires 50 API calls, exceeding a 20 RPD free-tier quota; consider documenting quota requirements clearly or tuning batch size cleanly once latency/output-truncation trade-offs are benchmarked.
