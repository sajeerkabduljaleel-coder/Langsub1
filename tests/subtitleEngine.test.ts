import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSubtitleBuffer } from '../server/subtitles/parser.ts';
import {
  alignDualSubtitles,
  annotateSplitSentences,
  auditAlignedCues,
} from '../server/subtitles/aligner.ts';
import {
  generateAssContent,
  generateSrtContent,
  generateVttContent,
} from '../server/subtitles/exporter.ts';
import {
  buildSystemInstruction,
  getLanguagePhoneticRules,
  processTriLineConversion,
  type BatchInputCue,
} from '../server/ai/translator.ts';
import {
  buildLineCacheKey,
  buildProjectCacheKey,
  resetStoreForTests,
} from '../server/db/store.ts';
import {
  DEFAULT_PROCESSING_OPTIONS,
  DEFAULT_STYLE_CONFIG,
  type RawCue,
  type TriLineCue,
} from '../src/types/subtitle.ts';
import {
  computeEffectiveCueDurationMs,
  getActiveWordIndex,
  resolveCueTickCompletion,
  tokenizeCueWords,
} from '../src/utils/learningControls.ts';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'langsub-phase2-'));
  process.env.TRILINE_DB_PATH = path.join(tmpDir, 'db.json');
  await resetStoreForTests();
});

afterEach(async () => {
  delete process.env.TRILINE_DB_PATH;
  await resetStoreForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('Phase 2: Multilingual Parsing, Line Breaks & Overlapping Cues', () => {
  it('preserves short (<200ms) and long dialogue timestamps, punctuation, and detects overlaps', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:01,120',
      'はい！',
      '',
      '2',
      '00:00:02,000 --> 00:00:20,000',
      'Das war eine unglaublich lange Erklärung,<br/>aber am Ende haben alle verstanden.',
      '',
      '3',
      '00:00:18,500 --> 00:00:21,200',
      '— Правда?<br>— Конечно!',
      '',
      '4',
      '00:00:22,000 --> 00:00:24,500',
      'هل أنت مستعد؟',
      '',
    ].join('\n');

    const parsed = parseSubtitleBuffer(
      Buffer.from(srt, 'utf8'),
      'multilingual.srt',
      DEFAULT_PROCESSING_OPTIONS,
    );

    assert.equal(parsed.cues.length, 4);
    // Short 120ms cue preserved verbatim without artificial clamping
    assert.equal(parsed.cues[0].startMs, 1000);
    assert.equal(parsed.cues[0].endMs, 1120);
    assert.equal(parsed.cues[0].text, 'はい！');

    // Long 18s cue with <br/> converts break cleanly and merges multiline
    assert.equal(parsed.cues[1].startMs, 2000);
    assert.equal(parsed.cues[1].endMs, 20000);
    assert.equal(
      parsed.cues[1].text,
      'Das war eine unglaublich lange Erklärung, aber am Ende haben alle verstanden.',
    );

    // Russian + Arabic cues preserve punctuation and script
    assert.equal(parsed.cues[2].text, '— Правда? — Конечно!');
    assert.equal(parsed.cues[3].text, 'هل أنت مستعد؟');

    // Overlap between cue 2 (ends 20000ms) and cue 3 (starts 18500ms) detected
    assert.equal(parsed.report.overlappingCueCount, 1);
  });

  it('merges CJK multiline dialogue without injecting unwanted Latin spaces', () => {
    const ass = [
      '[Script Info]',
      'Title: Japanese Multiline',
      'ScriptType: v4.00+',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,明日の朝、\\N駅で会いましょう。',
      '',
    ].join('\n');

    const parsed = parseSubtitleBuffer(
      Buffer.from(ass, 'utf8'),
      'ja_lines.ass',
      DEFAULT_PROCESSING_OPTIONS,
    );

    assert.equal(parsed.cues.length, 1);
    assert.equal(parsed.cues[0].text, '明日の朝、駅で会いましょう。');
  });

  it('exports SRT, WebVTT, and ASS preserving exact cue timings and custom line order', () => {
    const cues: TriLineCue[] = [
      {
        id: 'cue-1',
        index: 1,
        startMs: 1234,
        endMs: 1354,
        baseText: 'Yes!',
        targetText: 'はい！',
        phoneticText: 'hai!',
      },
      {
        id: 'cue-2',
        index: 2,
        startMs: 1300,
        endMs: 4950,
        baseText: 'Are you ready?',
        targetText: 'هل أنت مستعد؟',
        phoneticText: 'hal an-ta mus-ta-idd?',
      },
    ];

    const customStyle = {
      ...DEFAULT_STYLE_CONFIG,
      lineOrder: ['target', 'phonetic', 'base'] as TriLineCue extends never
        ? never
        : ('base' | 'target' | 'phonetic')[],
      srtIncludeBom: false,
    };

    const srt = generateSrtContent(cues, customStyle);
    assert.ok(srt.includes('00:00:01,234 --> 00:00:01,354\nはい！\nhai!\nYes!'));
    assert.ok(srt.includes('00:00:01,300 --> 00:00:04,950\nهل أنت مستعد؟'));

    const vtt = generateVttContent(cues, customStyle);
    assert.ok(vtt.startsWith('WEBVTT\n\n'));
    assert.ok(vtt.includes('00:00:01.234 --> 00:00:01.354\nはい！\nhai!\nYes!'));
    assert.ok(vtt.includes('00:00:01.300 --> 00:00:04.950\nهل أنت مستعد؟'));

    const ass = generateAssContent(cues, customStyle, 'Phase2 Export');
    assert.ok(ass.includes('Dialogue: 0,0:00:01.23,0:00:01.35,TargetLang,,0,0,0,,はい！\\N{\\rPhonetics}hai!\\N{\\rBaseLang}Yes!'));
  });
});

describe('Phase 2: Alignment, Split Sentences & Quality Audit', () => {
  it('annotates split multi-cue sentences and audits overlapping/duplicate cues', () => {
    const targetCues: RawCue[] = [
      {
        index: 1,
        startMs: 1000,
        endMs: 2500,
        text: 'Even though the train was delayed',
        originalText: 'Even though the train was delayed',
      },
      {
        index: 2,
        startMs: 2600,
        endMs: 4200,
        text: 'we arrived right on time.',
        originalText: 'we arrived right on time.',
      },
      {
        index: 3,
        startMs: 3900,
        endMs: 5200,
        text: 'we arrived right on time.',
        originalText: 'we arrived right on time.',
      },
    ];

    const hints = annotateSplitSentences(targetCues);
    assert.equal(hints[0].continuesFromPrev, false);
    assert.equal(hints[0].continuesToNext, true);
    assert.equal(hints[1].continuesFromPrev, true);
    assert.equal(hints[1].continuesToNext, false);

    const baseCues: RawCue[] = [
      {
        index: 1,
        startMs: 1000,
        endMs: 2500,
        text: 'Obwohl der Zug Verspätung hatte',
        originalText: 'Obwohl der Zug Verspätung hatte',
      },
      {
        index: 2,
        startMs: 2600,
        endMs: 4200,
        text: 'kamen wir pünktlich an.',
        originalText: 'kamen wir pünktlich an.',
      },
    ];

    const alignment = alignDualSubtitles(targetCues, baseCues);
    assert.equal(alignment.stats.overlappingCues, 1);

    const audit = auditAlignedCues(alignment.aligned);
    assert.equal(audit.overlappingCount, 1);
    assert.equal(audit.duplicateAdjacentCount, 1);
  });
});

describe('Phase 2: Translation Styles, Transliteration Rules & Context Window', () => {
  it('provides script-specific phonological guidance for non-Latin languages and standard Romanization', () => {
    const jaStandard = getLanguagePhoneticRules('Japanese', 'standard');
    assert.ok(jaStandard.includes('Hepburn'));

    const koHyphen = getLanguagePhoneticRules('Korean', 'hyphenated');
    assert.ok(koHyphen.includes('batchim'));

    const arRules = getLanguagePhoneticRules('Arabic', 'hyphenated');
    assert.ok(arRules.includes('unwritten short vowels'));

    const ruRules = getLanguagePhoneticRules('Russian', 'flowing');
    assert.ok(ruRules.includes('vowel reduction'));

    const hiStandard = getLanguagePhoneticRules('Hindi', 'standard');
    assert.ok(hiStandard.includes('schwa'));
  });

  it('includes translation style instructions and passes preceding, following, split-cue & glossary context', async () => {
    const sysColloquial = buildSystemInstruction({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'French',
      phoneticStyle: 'standard',
      translationStyle: 'colloquial',
    });
    assert.ok(sysColloquial.includes('COLLOQUIAL'));
    assert.ok(sysColloquial.includes('romanization'));

    // Build 22 cues so batch 2 receives preceding context, following context (or glossary from batch 1)
    const cues: BatchInputCue[] = Array.from({ length: 22 }, (_, idx) => ({
      index: idx + 1,
      startMs: (idx + 1) * 2000,
      endMs: (idx + 1) * 2000 + 1500,
      baseText: '',
      targetText:
        idx === 0
          ? 'Quand le train partira'
          : idx === 1
            ? 'nous irons à Kyoto.'
            : `Ligne ${idx + 1}.`,
    }));

    const capturedPayloads: Array<{
      contextBeforeCount: number;
      contextAfterCount: number;
      glossaryCount: number;
      firstCueContinuesToNext?: boolean;
      secondCueContinuesFromPrev?: boolean;
    }> = [];

    const result = await processTriLineConversion({
      cues,
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'French',
      phoneticStyle: 'hyphenated',
      translationStyle: 'formal',
      retryDelayBaseMs: 0,
      onProgress: () => {},
      generateBatchFn: async ({ contents }) => {
        const parsed = JSON.parse(contents) as {
          cuesToProcess: Array<{
            index: number;
            targetText: string;
            continuesFromPrev?: boolean;
            continuesToNext?: boolean;
          }>;
          readOnlyPrecedingContext: unknown[];
          readOnlyFollowingContext: unknown[];
          readOnlyConsistencyGlossary: Array<{
            baseText: string;
            targetText: string;
            phoneticText: string;
          }>;
        };

        capturedPayloads.push({
          contextBeforeCount: parsed.readOnlyPrecedingContext.length,
          contextAfterCount: parsed.readOnlyFollowingContext.length,
          glossaryCount: parsed.readOnlyConsistencyGlossary.length,
          firstCueContinuesToNext: parsed.cuesToProcess[0]?.continuesToNext,
          secondCueContinuesFromPrev: parsed.cuesToProcess[1]?.continuesFromPrev,
        });

        return JSON.stringify({
          items: parsed.cuesToProcess.map((c) => ({
            index: c.index,
            baseText: `Formal translation ${c.index}`,
            targetText: c.targetText,
            phoneticText: `fawr-mal ${c.index}`,
          })),
        });
      },
    });

    assert.equal(result.cues.length, 22);
    assert.equal(capturedPayloads.length, 2);
    // Batch 1 has following context from cues 21-22 and split sentence hints for cues 1-2
    assert.equal(capturedPayloads[0].contextBeforeCount, 0);
    assert.equal(capturedPayloads[0].contextAfterCount, 2);
    assert.equal(capturedPayloads[0].firstCueContinuesToNext, true);
    assert.equal(capturedPayloads[0].secondCueContinuesFromPrev, true);

    // Batch 2 receives preceding context and bilingual+phonetic glossary from batch 1
    assert.equal(capturedPayloads[1].contextBeforeCount, 3);
    assert.ok(capturedPayloads[1].glossaryCount > 0);
  });

  it('separates line and project cache keys by translationStyle', () => {
    const naturalLine = buildLineCacheKey({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'Spanish',
      phoneticStyle: 'hyphenated',
      translationStyle: 'natural',
      sourcePrimary: '¿Qué pasa?',
    });
    const formalLine = buildLineCacheKey({
      mode: 'target-first',
      baseLang: 'English',
      targetLang: 'Spanish',
      phoneticStyle: 'hyphenated',
      translationStyle: 'formal',
      sourcePrimary: '¿Qué pasa?',
    });
    assert.notEqual(naturalLine, formalLine);

    const projNatural = buildProjectCacheKey({
      sourceHash: 'abc',
      baseLang: 'English',
      targetLang: 'Spanish',
      mode: 'target-first',
      phoneticStyle: 'hyphenated',
      translationStyle: 'natural',
      processingOptions: DEFAULT_PROCESSING_OPTIONS,
    });
    const projColloquial = buildProjectCacheKey({
      sourceHash: 'abc',
      baseLang: 'English',
      targetLang: 'Spanish',
      mode: 'target-first',
      phoneticStyle: 'hyphenated',
      translationStyle: 'colloquial',
      processingOptions: DEFAULT_PROCESSING_OPTIONS,
    });
    assert.notEqual(projNatural, projColloquial);
  });
});

describe('Phase 2: Learning Controls Helpers', () => {
  it('tokenizes spaced and CJK subtitle text accurately for word highlighting', () => {
    assert.deepEqual(tokenizeCueWords('Ich verstehe das nicht.'), [
      'Ich',
      'verstehe',
      'das',
      'nicht.',
    ]);
    assert.deepEqual(tokenizeCueWords('もうすぐ終点です。'), [
      'も',
      'う',
      'す',
      'ぐ',
      '終',
      '点',
      'で',
      'す。',
    ]);
    assert.deepEqual(tokenizeCueWords('moh-soo-goo shoo-ten dess'), [
      'moh-soo-goo',
      'shoo-ten',
      'dess',
    ]);
  });

  it('computes active word progress, playback speed scaling, inter-cue pause, and cue repeat', () => {
    const tokens = ['one', 'two', 'three', 'four'];
    assert.equal(getActiveWordIndex(tokens, 0, 2000), 0);
    assert.equal(getActiveWordIndex(tokens, 600, 2000), 1);
    assert.equal(getActiveWordIndex(tokens, 1900, 2000), 3);

    const cue = { startMs: 1000, endMs: 3000 }; // 2000ms base duration
    assert.equal(computeEffectiveCueDurationMs(cue, 1), 2000);
    assert.equal(computeEffectiveCueDurationMs(cue, 0.5), 4000);
    assert.equal(computeEffectiveCueDurationMs(cue, 2), 1000);

    // Repeat current cue without inter-cue pause
    const repeatDirect = resolveCueTickCompletion({
      currentIndex: 1,
      totalCues: 5,
      repeatCurrentCue: true,
      pauseBetweenCuesMs: 0,
    });
    assert.equal(repeatDirect.nextPhase, 'playing');
    assert.equal(repeatDirect.nextCueIndex, 1);

    // Advance to next cue with shadowing pause
    const pauseNext = resolveCueTickCompletion({
      currentIndex: 1,
      totalCues: 5,
      repeatCurrentCue: false,
      pauseBetweenCuesMs: 1500,
    });
    assert.equal(pauseNext.nextPhase, 'pausing');
    assert.equal(pauseNext.nextCueIndex, 2);
    assert.equal(pauseNext.nextPauseRemainingMs, 1500);

    // Stop cleanly on final cue when repeat is off
    const stopEnd = resolveCueTickCompletion({
      currentIndex: 4,
      totalCues: 5,
      repeatCurrentCue: false,
      pauseBetweenCuesMs: 1000,
    });
    assert.equal(stopEnd.nextPhase, 'stopped');
    assert.equal(stopEnd.nextCueIndex, 4);
  });
});
