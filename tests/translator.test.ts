import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  processTriLineConversion,
  type BatchInputCue,
} from '../server/ai/translator.ts';
import {
  buildLineCacheKey,
  buildProjectCacheKey,
  getCachedLine,
  resetStoreForTests,
} from '../server/db/store.ts';
import { DEFAULT_PROCESSING_OPTIONS } from '../src/types/subtitle.ts';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langsub-trans-'));
  process.env.TRILINE_DB_PATH = path.join(tmpDir, 'db.json');
  await resetStoreForTests();
});

afterEach(async () => {
  delete process.env.TRILINE_DB_PATH;
  await resetStoreForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('AI Translator Hardening & Cache Keys', () => {
  it('retries malformed, empty, IPA, and leaked non-Latin responses until valid, preserving original targetText', async () => {
    const cues: BatchInputCue[] = [
      {
        index: 1,
        startMs: 1000,
        endMs: 3000,
        baseText: '',
        targetText: 'Ich verstehe nicht.',
      },
      {
        index: 2,
        startMs: 3500,
        endMs: 6000,
        baseText: '',
        targetText: 'もうすぐ終点ですね。',
      },
    ];

    let attempt = 0;
    const result = await processTriLineConversion({
      cues,
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'German',
      phoneticStyle: 'hyphenated',
      retryDelayBaseMs: 0,
      onProgress: () => {},
      generateBatchFn: async () => {
        attempt++;
        if (attempt === 1) {
          // Malformed / empty JSON
          return '   ';
        }
        if (attempt === 2) {
          // Contains IPA symbol 'ɪ' — must be rejected and retried
          return JSON.stringify({
            items: [
              {
                index: 1,
                baseText: "I don't understand.",
                targetText: 'REWRITTEN',
                phoneticText: 'ɪkh fer-SHTAY-uh nikht',
              },
              {
                index: 2,
                baseText: 'Almost at the final stop.',
                targetText: 'もうすぐ終点ですね。',
                phoneticText: 'moh-soo-goo shoo-ten dess neh.',
              },
            ],
          });
        }
        // Valid 3rd attempt (even if model attempts to alter targetText, original targetText MUST be preserved!)
        return JSON.stringify({
          items: [
            {
              index: 1,
              baseText: "I don't understand.",
              targetText: 'Model tried to rewrite',
              phoneticText: 'ikh fer-SHTAY-uh nikht.',
            },
            {
              index: 2,
              baseText: 'Almost at the final stop.',
              targetText: 'Model tried to rewrite 2',
              phoneticText: 'moh-soo-goo shoo-ten dess neh.',
            },
          ],
        });
      },
    });

    assert.equal(attempt, 3);
    assert.equal(result.cues.length, 2);
    assert.equal(result.cues[0].targetText, 'Ich verstehe nicht.');
    assert.equal(result.cues[1].targetText, 'もうすぐ終点ですね。');
    assert.equal(result.cues[0].baseText, "I don't understand.");
    assert.equal(result.cues[0].phoneticText, 'ikh fer-SHTAY-uh nikht.');
  });

  it('rejects leaked non-Latin characters in phoneticText', async () => {
    const cues: BatchInputCue[] = [
      { index: 1, startMs: 1000, endMs: 3000, baseText: '', targetText: 'こんにちは。' },
    ];

    await assert.rejects(
      () =>
        processTriLineConversion({
          cues,
          mode: 'target-first',
          baseLang: 'English',
          targetLang: 'Japanese',
          phoneticStyle: 'flowing',
          retryDelayBaseMs: 0,
          onProgress: () => {},
          generateBatchFn: async () =>
            JSON.stringify({
              items: [
                {
                  index: 1,
                  baseText: 'Hello.',
                  targetText: 'こんにちは。',
                  phoneticText: 'kon-nee-ちは',
                },
              ],
            }),
        }),
      /Non-Latin script leaked/,
    );
  });

  it('isolates batch failures: preserves completed earlier batches in line cache and passes glossary across batches', async () => {
    const cues: BatchInputCue[] = Array.from({ length: 22 }, (_, i) => ({
      index: i + 1,
      startMs: i * 1000,
      endMs: i * 1000 + 800,
      baseText: '',
      targetText: `Bonjour Élodie ${i + 1}`,
    }));

    let batchCalls = 0;
    const seenGlossaries: unknown[] = [];

    await assert.rejects(
      () =>
        processTriLineConversion({
          cues,
          mode: 'target-first',
          baseLang: 'English',
          targetLang: 'French',
          phoneticStyle: 'hyphenated',
          retryDelayBaseMs: 0,
          onProgress: () => {},
          generateBatchFn: async ({ contents }) => {
            batchCalls++;
            const payload = JSON.parse(contents) as {
              readOnlyConsistencyGlossary: Array<{ targetText: string; phoneticText: string }>;
              cuesToProcess: Array<{ index: number; targetText: string }>;
            };
            seenGlossaries.push(payload.readOnlyConsistencyGlossary);

            // Batch 1 (20 cues) succeeds; Batch 2 (2 cues) fails all retries
            if (payload.cuesToProcess[0].index === 1) {
              return JSON.stringify({
                items: payload.cuesToProcess.map((c) => ({
                  index: c.index,
                  baseText: `Hello Élodie ${c.index}`,
                  targetText: c.targetText,
                  phoneticText: `boh(n)-ZHOOR ay-loh-DEE ${c.index}`,
                })),
              });
            }
            return ''; // empty failure for batch 2
          },
        }),
      /Batch 2\/2 failed.*1 completed batch\(es\) remain safely cached/,
    );

    assert.equal(batchCalls, 4); // 1 call for batch 1 + 3 retries for batch 2
    // Batch 2 received consistency glossary populated from Batch 1
    const batch2Glossary = seenGlossaries[1] as Array<{ targetText: string; phoneticText: string }>;
    assert.ok(batch2Glossary.length > 0);

    // Cue 1 from Batch 1 is persisted in lineCache; Cue 21 from failed Batch 2 is NOT
    const key1 = buildLineCacheKey({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'French',
      phoneticStyle: 'hyphenated',
      sourcePrimary: 'Bonjour Élodie 1',
      sourceSecondary: '',
    });
    const key21 = buildLineCacheKey({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'French',
      phoneticStyle: 'hyphenated',
      sourcePrimary: 'Bonjour Élodie 21',
      sourceSecondary: '',
    });
    assert.ok(await getCachedLine(key1));
    assert.equal(await getCachedLine(key21), null);
  });

  it('produces distinct cache keys whenever any output-affecting setting changes', () => {
    const baseProj = {
      sourceHash: 'abc123',
      secondaryHash: 'def456',
      baseLang: 'English',
      targetLang: 'German',
      mode: 'dual-merge' as const,
      phoneticStyle: 'hyphenated' as const,
      processingOptions: DEFAULT_PROCESSING_OPTIONS,
    };

    const k0 = buildProjectCacheKey(baseProj);
    assert.notEqual(k0, buildProjectCacheKey({ ...baseProj, phoneticStyle: 'flowing' }));
    assert.notEqual(k0, buildProjectCacheKey({ ...baseProj, targetLang: 'French' }));
    assert.notEqual(k0, buildProjectCacheKey({ ...baseProj, mode: 'target-first' }));
    assert.notEqual(
      k0,
      buildProjectCacheKey({
        ...baseProj,
        processingOptions: { ...DEFAULT_PROCESSING_OPTIONS, removeSdh: false },
      }),
    );
    assert.notEqual(
      k0,
      buildProjectCacheKey({ ...baseProj, alignmentOverridesHash: 'override-hash-1' }),
    );
    assert.notEqual(k0, buildProjectCacheKey({ ...baseProj, model: 'gemini-4-argon' }));
    assert.notEqual(k0, buildProjectCacheKey({ ...baseProj, promptVersion: 'v99' }));

    const l0 = buildLineCacheKey({
      mode: 'base-first',
      baseLang: 'English',
      targetLang: 'Spanish',
      phoneticStyle: 'hyphenated',
      sourcePrimary: 'Hello there',
      sourceSecondary: '',
    });
    const lWithSecondary = buildLineCacheKey({
      mode: 'base-first',
      baseLang: 'English',
      targetLang: 'Spanish',
      phoneticStyle: 'hyphenated',
      sourcePrimary: 'Hello there',
      sourceSecondary: 'Hola',
    });
    assert.notEqual(l0, lWithSecondary);
  });
});
