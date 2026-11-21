import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ALIGNMENT_BENCHMARK_CASES,
  LANGUAGE_BENCHMARK_SAMPLES,
  type DialogueTag,
} from '../benchmarks/dataset.ts';
import { evaluateAlignmentCase } from '../benchmarks/runBenchmark.ts';
import {
  buildSystemInstruction,
  formatGeminiErrorMessage,
  isNonRetryableApiError,
  processTriLineConversion,
  type BatchInputCue,
} from '../server/ai/translator.ts';
import { resetStoreForTests } from '../server/db/store.ts';
import {
  alignDualSubtitles,
  estimateGlobalTimeTransform,
} from '../server/subtitles/aligner.ts';
import { parseSubtitleBuffer } from '../server/subtitles/parser.ts';
import { DEFAULT_PROCESSING_OPTIONS, type RawCue } from '../src/types/subtitle.ts';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langsub-p4a-'));
  process.env.TRILINE_DB_PATH = path.join(tmpDir, 'db.json');
  await resetStoreForTests();
});

afterEach(async () => {
  delete process.env.TRILINE_DB_PATH;
  await resetStoreForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Phase 4A: Benchmark Dataset & Alignment Regression Suite', () => {
  it('covers German, French, Japanese, and Korean with all 9 required dialogue types and valid SRT parsing', () => {
    const requiredTags: DialogueTag[] = [
      'everyday',
      'fast',
      'idiom-slang',
      'question-short',
      'long-split',
      'contraction',
      'proper-noun',
      'emotional',
      'contextual-ambiguity',
    ];

    assert.deepEqual(
      LANGUAGE_BENCHMARK_SAMPLES.map((s) => s.language),
      ['German', 'French', 'Japanese', 'Korean'],
    );

    for (const sample of LANGUAGE_BENCHMARK_SAMPLES) {
      const targetParsed = parseSubtitleBuffer(
        Buffer.from(sample.targetSrt, 'utf8'),
        `${sample.id}-target.srt`,
        DEFAULT_PROCESSING_OPTIONS,
      );
      const baseParsed = parseSubtitleBuffer(
        Buffer.from(sample.pairedBaseSrt, 'utf8'),
        `${sample.id}-base.srt`,
        DEFAULT_PROCESSING_OPTIONS,
      );

      assert.equal(targetParsed.cues.length, 12, `${sample.id} target cue count`);
      assert.equal(baseParsed.cues.length, 12, `${sample.id} base cue count`);

      const seenTags = new Set<DialogueTag>();
      for (const exp of sample.cueExpectations) {
        exp.tags.forEach((t) => seenTags.add(t));
      }
      for (const tag of requiredTags) {
        assert.ok(seenTags.has(tag), `${sample.id} missing dialogue tag "${tag}"`);
      }
    }
  });

  it('passes all 4 alignment benchmark scenarios including progressive timing drift with 100% association accuracy', () => {
    for (const tc of ALIGNMENT_BENCHMARK_CASES) {
      const evalResult = evaluateAlignmentCase(tc);
      assert.equal(
        evalResult.failures.length,
        0,
        `${tc.id} had alignment failures: ${JSON.stringify(evalResult.failures)}`,
      );
      assert.equal(evalResult.associationAccuracyPct, 100, `${tc.id} association accuracy`);
      assert.equal(evalResult.timingPreservedPct, 100, `${tc.id} timing preservation`);
      assert.equal(evalResult.unmatchedBaseMatch, true, `${tc.id} unmatched base preservation`);
    }
  });

  it('compensates for 45-minute PAL 25fps vs NTSC 23.976fps framerate drift (~115s cumulative drift) without collapsing cues', () => {
    // 25 / 23.976 ≈ 1.042709 -> target runs 4.27% slower than base
    const fpsRatio = 25 / 23.976;
    const baseCues: RawCue[] = [];
    const targetCues: RawCue[] = [];

    for (let i = 0; i < 30; i++) {
      const bStart = 10_000 + i * 90_000; // Spans 00:10 to 43:40 (~2620s)
      const bEnd = bStart + 2600;
      const tStart = Math.round(bStart * fpsRatio + 500);
      const tEnd = Math.round(bEnd * fpsRatio + 500);

      baseCues.push({
        index: i + 1,
        startMs: bStart,
        endMs: bEnd,
        text: `English cue number ${i + 1}`,
        originalText: `English cue number ${i + 1}`,
      });
      targetCues.push({
        index: i + 1,
        startMs: tStart,
        endMs: tEnd,
        text: `Deutsch Zeile Nummer ${i + 1}`,
        originalText: `Deutsch Zeile Nummer ${i + 1}`,
      });
    }

    const transform = estimateGlobalTimeTransform(targetCues, baseCues);
    assert.ok(
      Math.abs(transform.scale - fpsRatio) < 0.002,
      `expected scale near ${fpsRatio.toFixed(4)}, got ${transform.scale}`,
    );

    const aligned = alignDualSubtitles(targetCues, baseCues);
    assert.equal(aligned.aligned.length, 30);
    assert.equal(aligned.stats.exactMatches, 30);
    assert.equal(aligned.stats.unmatchedTarget, 0);
    assert.equal(aligned.stats.unmatchedBase, 0);
    for (let i = 0; i < 30; i++) {
      assert.equal(aligned.aligned[i].baseText, `English cue number ${i + 1}`);
      assert.equal(aligned.aligned[i].startMs, targetCues[i].startMs);
      assert.equal(aligned.aligned[i].endMs, targetCues[i].endMs);
    }
  });
});

describe('Phase 4A: Demonstrated Phonetic & Quota Error Fixes', () => {
  it('rejects leaked foreign umlauts/diacritics in hyphenated/flowing modes and retries cleanly, while allowing standard mode', async () => {
    const cues: BatchInputCue[] = [
      {
        index: 1,
        startMs: 1000,
        endMs: 3500,
        baseText: 'Munich is waiting.',
        targetText: 'München wartet, drüber reden wir später.',
      },
    ];

    let attempts = 0;
    const res = await processTriLineConversion({
      cues,
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'German',
      phoneticStyle: 'hyphenated',
      retryDelayBaseMs: 0,
      onProgress: () => {},
      generateBatchFn: async () => {
        attempts++;
        if (attempts === 1) {
          // Reproduces real live defect observed in German base-first output ("MÜN-khen", "DRÜ-ber")
          return JSON.stringify({
            items: [
              {
                index: 1,
                baseText: 'Munich is waiting, we will talk about it later.',
                targetText: cues[0].targetText,
                phoneticText: 'MÜN-khen VAR-tet, DRÜ-ber RAY-den veer SHPAY-ter.',
              },
            ],
          });
        }
        return JSON.stringify({
          items: [
            {
              index: 1,
              baseText: 'Munich is waiting, we will talk about it later.',
              targetText: cues[0].targetText,
              phoneticText: 'MEWN-khen VAR-tet, DREW-ber RAY-den veer SHPAY-ter.',
            },
          ],
        });
      },
    });

    assert.equal(attempts, 2);
    assert.equal(
      res.cues[0].phoneticText,
      'MEWN-khen VAR-tet, DREW-ber RAY-den veer SHPAY-ter.',
    );

    // Standard mode remains unaffected if orthographic Latin diacritics appear
    const stdRes = await processTriLineConversion({
      cues,
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'German',
      phoneticStyle: 'standard',
      skipLineCache: true,
      retryDelayBaseMs: 0,
      onProgress: () => {},
      generateBatchFn: async () =>
        JSON.stringify({
          items: [
            {
              index: 1,
              baseText: 'Munich is waiting.',
              targetText: cues[0].targetText,
              phoneticText: 'München wartet.',
            },
          ],
        }),
    });
    assert.equal(stdRes.cues[0].phoneticText, 'München wartet.');
  });

  it('includes targeted phonetic rules for demonstrated German, French, Japanese, and Korean defects', () => {
    const deInstr = buildSystemInstruction({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'German',
      phoneticStyle: 'hyphenated',
    });
    assert.match(deInstr, /MEWN-khen/);
    assert.match(deInstr, /NEVER output ü\/ö\/ä\/ß/i);

    const frInstr = buildSystemInstruction({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'French',
      phoneticStyle: 'hyphenated',
    });
    assert.match(frInstr, /tra-VIGH/);
    assert.match(frInstr, /ka-bee-NEH/);

    const jaInstr = buildSystemInstruction({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'Japanese',
      phoneticStyle: 'hyphenated',
    });
    assert.match(jaInstr, /SPACE-SEPARATED/);

    const koInstr = buildSystemInstruction({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'Korean',
      phoneticStyle: 'hyphenated',
    });
    assert.match(koInstr, /NEVER use Revised Romanization/i);
    assert.match(koInstr, /chuhl-LEE/);
    assert.match(koInstr, /hwah-GEE-neh/);
  });

  it('fails fast without wasting retries on daily Gemini quota exhaustion and formats raw JSON errors cleanly', async () => {
    const rawDailyQuotaJson = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message:
          'You exceeded your current quota.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, description: Generate content requests per day limit exceeded on Free Tier.',
      },
    });

    assert.equal(isNonRetryableApiError(new Error(rawDailyQuotaJson)), true);
    const formatted = formatGeminiErrorMessage(new Error(rawDailyQuotaJson));
    assert.match(formatted, /daily request quota exceeded/i);
    assert.ok(!formatted.includes('{"error"'), 'raw JSON blob must not leak into user message');

    let calls = 0;
    await assert.rejects(
      () =>
        processTriLineConversion({
          cues: [
            { index: 1, startMs: 0, endMs: 2000, baseText: '', targetText: 'Hallo Welt!' },
          ],
          mode: 'target-first',
          baseLang: 'English',
          targetLang: 'German',
          phoneticStyle: 'hyphenated',
          retryDelayBaseMs: 0,
          onProgress: () => {},
          generateBatchFn: async () => {
            calls++;
            throw new Error(rawDailyQuotaJson);
          },
        }),
      /daily request quota exceeded/i,
    );
    assert.equal(calls, 1, 'daily quota exhaustion should fail fast without 3x retries');
  });
});
