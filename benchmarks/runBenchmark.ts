import fs from 'node:fs/promises';
import path from 'node:path';
import { alignDualSubtitles, auditAlignedCues } from '../server/subtitles/aligner.ts';
import { parseSubtitleBuffer } from '../server/subtitles/parser.ts';
import type {
  AlignedCuePair,
  ConversionJob,
  ConversionMode,
  ParsedSubtitleResult,
  PhoneticStyle,
  ProcessingOptions,
  TranslationStyle,
  TriLineCue,
} from '../src/types/subtitle.ts';
import {
  ALIGNMENT_BENCHMARK_CASES,
  LANGUAGE_BENCHMARK_SAMPLES,
  type AlignmentBenchmarkCase,
  type LanguageBenchmarkSample,
} from './dataset.ts';

const API_BASE = process.env.BENCHMARK_API_BASE || 'http://localhost:3000';

const BENCHMARK_PARSE_OPTIONS: ProcessingOptions = {
  removeSdh: false,
  mergeMultiline: true,
  removeDuplicates: false,
  preserveFormattingTags: false,
};

export interface AlignmentCaseEvaluation {
  id: string;
  language: string;
  name: string;
  estimatedOffsetMs: number;
  totalExpectedTargets: number;
  exactTargetMatches: number;
  associationAccuracyPct: number;
  unmatchedBaseExpected: number[];
  unmatchedBaseActual: number[];
  unmatchedBaseMatch: boolean;
  timingPreservedPct: number;
  overlappingCues: number;
  failures: Array<{
    targetIndex: number;
    scenarioTag: string;
    description: string;
    targetText: string;
    expectedBaseIndices: number[];
    actualBaseIndices: number[];
    actualRelationship: string;
    actualConfidence: number;
    actualBaseText: string;
  }>;
  resultingCues: Array<{
    index: number;
    startMs: number;
    endMs: number;
    relationship: string;
    confidence: number;
    uncertain: boolean;
    matchedTargetIndices: number[];
    matchedBaseIndices: number[];
    targetText: string;
    baseText: string;
  }>;
}

export function evaluateAlignmentCase(testCase: AlignmentBenchmarkCase): AlignmentCaseEvaluation {
  const targetParsed = parseSubtitleBuffer(
    Buffer.from(testCase.targetSrt, 'utf8'),
    `${testCase.id}-target.srt`,
    BENCHMARK_PARSE_OPTIONS,
  );
  const baseParsed = parseSubtitleBuffer(
    Buffer.from(testCase.baseSrt, 'utf8'),
    `${testCase.id}-base.srt`,
    BENCHMARK_PARSE_OPTIONS,
  );

  const preview = alignDualSubtitles(targetParsed.cues, baseParsed.cues);
  const audit = auditAlignedCues(preview.aligned);

  const byTargetIdx = new Map<number, AlignedCuePair>();
  for (const pair of preview.aligned) {
    for (const tIdx of pair.matchedTargetIndices) {
      byTargetIdx.set(tIdx, pair);
    }
  }

  let exactMatches = 0;
  let timingExact = 0;
  const failures: AlignmentCaseEvaluation['failures'] = [];

  for (const exp of testCase.expectedTargetPairs) {
    const origTarget = targetParsed.cues.find((c) => c.index === exp.targetIndex);
    const actual = byTargetIdx.get(exp.targetIndex);
    const actualBaseIndices = actual ? [...actual.matchedBaseIndices].sort((a, b) => a - b) : [];
    const expectedSorted = [...exp.expectedBaseIndices].sort((a, b) => a - b);

    const matched =
      actualBaseIndices.length === expectedSorted.length &&
      actualBaseIndices.every((v, i) => v === expectedSorted[i]);

    if (matched) {
      exactMatches++;
    } else {
      failures.push({
        targetIndex: exp.targetIndex,
        scenarioTag: exp.scenarioTag,
        description: exp.description,
        targetText: origTarget?.text || '',
        expectedBaseIndices: expectedSorted,
        actualBaseIndices,
        actualRelationship: actual?.relationship || 'missing',
        actualConfidence: actual?.confidence ?? 0,
        actualBaseText: actual?.baseText || '',
      });
    }

    if (
      origTarget &&
      actual &&
      actual.startMs === origTarget.startMs &&
      actual.endMs === origTarget.endMs
    ) {
      timingExact++;
    }
  }

  const unmatchedBaseActual = preview.unmatchedBaseCues.map((u) => u.index).sort((a, b) => a - b);
  const unmatchedBaseExpected = [...testCase.expectedUnmatchedBaseIndices].sort((a, b) => a - b);
  const unmatchedBaseMatch =
    unmatchedBaseActual.length === unmatchedBaseExpected.length &&
    unmatchedBaseActual.every((v, i) => v === unmatchedBaseExpected[i]);

  return {
    id: testCase.id,
    language: testCase.language,
    name: testCase.name,
    estimatedOffsetMs: preview.stats.estimatedOffsetMs,
    totalExpectedTargets: testCase.expectedTargetPairs.length,
    exactTargetMatches: exactMatches,
    associationAccuracyPct: Number(
      ((exactMatches / Math.max(1, testCase.expectedTargetPairs.length)) * 100).toFixed(1),
    ),
    unmatchedBaseExpected,
    unmatchedBaseActual,
    unmatchedBaseMatch,
    timingPreservedPct: Number(
      ((timingExact / Math.max(1, testCase.expectedTargetPairs.length)) * 100).toFixed(1),
    ),
    overlappingCues: audit.overlappingCount,
    failures,
    resultingCues: preview.aligned.map((c) => ({
      index: c.index,
      startMs: c.startMs,
      endMs: c.endMs,
      relationship: c.relationship,
      confidence: c.confidence,
      uncertain: c.uncertain,
      matchedTargetIndices: c.matchedTargetIndices,
      matchedBaseIndices: c.matchedBaseIndices,
      targetText: c.targetText,
      baseText: c.baseText,
    })),
  };
}

export interface LiveConversionRunResult {
  runId: string;
  sampleId: string;
  language: string;
  mode: ConversionMode;
  translationStyle: TranslationStyle;
  phoneticStyle: PhoneticStyle;
  durationMs: number;
  status: 'completed' | 'failed';
  error?: string;
  objectiveChecks: {
    expectedCueCount: number;
    actualCueCount: number;
    cueCountPreserved: boolean;
    originalPreservedCount: number;
    originalPreservedPct: number;
    timingPreservedCount: number;
    timingPreservedPct: number;
    allThreeLinesNonEmpty: boolean;
  };
  cues: Array<{
    index: number;
    startMs: number;
    endMs: number;
    targetText: string;
    phoneticText: string;
    baseText: string;
  }>;
}

async function runLiveConversionJob(params: {
  runId: string;
  sample: LanguageBenchmarkSample;
  mode: ConversionMode;
  translationStyle: TranslationStyle;
  phoneticStyle: PhoneticStyle;
}): Promise<LiveConversionRunResult> {
  const targetParsed: ParsedSubtitleResult = parseSubtitleBuffer(
    Buffer.from(params.sample.targetSrt, 'utf8'),
    `${params.sample.id}-target.srt`,
    BENCHMARK_PARSE_OPTIONS,
  );
  const baseParsed: ParsedSubtitleResult = parseSubtitleBuffer(
    Buffer.from(params.sample.pairedBaseSrt, 'utf8'),
    `${params.sample.id}-base.srt`,
    BENCHMARK_PARSE_OPTIONS,
  );

  const primaryParsed = params.mode === 'base-first' ? baseParsed : targetParsed;
  const secondaryParsed = params.mode === 'dual-merge' ? baseParsed : undefined;

  const startedAt = Date.now();
  try {
    const startRes = await fetch(`${API_BASE}/api/jobs/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: params.mode,
        baseLang: 'English',
        targetLang: params.sample.language,
        phoneticStyle: params.phoneticStyle,
        translationStyle: params.translationStyle,
        processingOptions: BENCHMARK_PARSE_OPTIONS,
        primaryParsed,
        secondaryParsed,
        forceRegenerate: true,
        movieMetadata: {
          title: `[Benchmark] ${params.sample.title} (${params.mode}/${params.translationStyle}/${params.phoneticStyle})`,
        },
      }),
    });

    if (!startRes.ok) {
      const errBody = await startRes.text();
      throw new Error(`POST /api/jobs/convert failed (${startRes.status}): ${errBody}`);
    }

    const startJson = (await startRes.json()) as {
      job?: ConversionJob;
      cachedProject?: { cues: TriLineCue[] };
    };
    const jobId = startJson.job?.jobId;
    if (!jobId) {
      throw new Error('POST /api/jobs/convert returned no jobId.');
    }

    let job: ConversionJob | null = startJson.job || null;
    for (let attempt = 0; attempt < 180; attempt++) {
      if (job && (job.status === 'completed' || job.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 500));
      const pollRes = await fetch(`${API_BASE}/api/jobs/${jobId}`);
      if (!pollRes.ok) {
        throw new Error(`GET /api/jobs/${jobId} failed (${pollRes.status})`);
      }
      const pollJson = (await pollRes.json()) as { job?: ConversionJob };
      job = pollJson.job || null;
    }

    if (!job || job.status !== 'completed' || !job.projectId) {
      throw new Error(job?.error || 'Conversion job timed out or did not complete.');
    }

    const projRes = await fetch(`${API_BASE}/api/projects/${job.projectId}`);
    if (!projRes.ok) {
      throw new Error(`GET /api/projects/${job.projectId} failed (${projRes.status})`);
    }
    const projJson = (await projRes.json()) as { project?: { cues: TriLineCue[] } };
    const outCues: TriLineCue[] = projJson.project?.cues || [];
    if (outCues.length === 0) {
      throw new Error('Completed project returned 0 cues.');
    }
    const refCues = primaryParsed.cues;

    let originalPreservedCount = 0;
    let timingPreservedCount = 0;
    let allThreeLinesNonEmpty = outCues.length > 0;

    for (let i = 0; i < Math.min(refCues.length, outCues.length); i++) {
      const ref = refCues[i];
      const out = outCues[i];
      const refSecondary = secondaryParsed?.cues[i];

      if (params.mode === 'target-first') {
        if (out.targetText === ref.text) originalPreservedCount++;
      } else if (params.mode === 'base-first') {
        if (out.baseText === ref.text) originalPreservedCount++;
      } else {
        if (out.targetText === ref.text && (!refSecondary || out.baseText === refSecondary.text)) {
          originalPreservedCount++;
        }
      }

      if (out.startMs === ref.startMs && out.endMs === ref.endMs) {
        timingPreservedCount++;
      }

      if (!out.targetText.trim() || !out.baseText.trim() || !out.phoneticText.trim()) {
        allThreeLinesNonEmpty = false;
      }
    }

    return {
      runId: params.runId,
      sampleId: params.sample.id,
      language: params.sample.language,
      mode: params.mode,
      translationStyle: params.translationStyle,
      phoneticStyle: params.phoneticStyle,
      durationMs: Date.now() - startedAt,
      status: 'completed',
      objectiveChecks: {
        expectedCueCount: refCues.length,
        actualCueCount: outCues.length,
        cueCountPreserved: outCues.length === refCues.length,
        originalPreservedCount,
        originalPreservedPct: Number(
          ((originalPreservedCount / Math.max(1, refCues.length)) * 100).toFixed(1),
        ),
        timingPreservedCount,
        timingPreservedPct: Number(
          ((timingPreservedCount / Math.max(1, refCues.length)) * 100).toFixed(1),
        ),
        allThreeLinesNonEmpty,
      },
      cues: outCues.map((c) => ({
        index: c.index,
        startMs: c.startMs,
        endMs: c.endMs,
        targetText: c.targetText,
        phoneticText: c.phoneticText,
        baseText: c.baseText,
      })),
    };
  } catch (err: unknown) {
    return {
      runId: params.runId,
      sampleId: params.sample.id,
      language: params.sample.language,
      mode: params.mode,
      translationStyle: params.translationStyle,
      phoneticStyle: params.phoneticStyle,
      durationMs: Date.now() - startedAt,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      objectiveChecks: {
        expectedCueCount: primaryParsed.cues.length,
        actualCueCount: 0,
        cueCountPreserved: false,
        originalPreservedCount: 0,
        originalPreservedPct: 0,
        timingPreservedCount: 0,
        timingPreservedPct: 0,
        allThreeLinesNonEmpty: false,
      },
      cues: [],
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : 'benchmarks/results-live.json';
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 && args[onlyIdx + 1] ? args[onlyIdx + 1] : 'all';

  const alignmentResults =
    only === 'all' || only === 'alignment'
      ? ALIGNMENT_BENCHMARK_CASES.map((tc) => evaluateAlignmentCase(tc))
      : [];

  const liveTasks: Array<{
    runId: string;
    sample: LanguageBenchmarkSample;
    mode: ConversionMode;
    translationStyle: TranslationStyle;
    phoneticStyle: PhoneticStyle;
  }> = [];

  if (only === 'all' || only === 'modes') {
    for (const sample of LANGUAGE_BENCHMARK_SAMPLES) {
      for (const mode of ['target-first', 'base-first', 'dual-merge'] as ConversionMode[]) {
        liveTasks.push({
          runId: `${sample.id}:${mode}:natural:hyphenated`,
          sample,
          mode,
          translationStyle: 'natural',
          phoneticStyle: 'hyphenated',
        });
      }
    }
  }

  if (only === 'all' || only === 'styles') {
    for (const sample of LANGUAGE_BENCHMARK_SAMPLES) {
      for (const style of ['literal', 'colloquial', 'formal'] as TranslationStyle[]) {
        liveTasks.push({
          runId: `${sample.id}:target-first:${style}:hyphenated`,
          sample,
          mode: 'target-first',
          translationStyle: style,
          phoneticStyle: 'hyphenated',
        });
      }
    }
  }

  if (only === 'all' || only === 'phonetics') {
    for (const sample of LANGUAGE_BENCHMARK_SAMPLES) {
      liveTasks.push({
        runId: `${sample.id}:target-first:natural:standard`,
        sample,
        mode: 'target-first',
        translationStyle: 'natural',
        phoneticStyle: 'standard',
      });
    }
  }

  let liveResults: LiveConversionRunResult[] = [];
  if (liveTasks.length > 0) {
    console.log(`Running ${liveTasks.length} live LangSub conversion benchmark jobs against ${API_BASE}...`);
    liveResults = await runWithConcurrency(liveTasks, 4, async (task) => {
      const res = await runLiveConversionJob(task);
      console.log(
        `  [${res.status.toUpperCase()}] ${res.runId} (${res.durationMs}ms) cues=${res.objectiveChecks.actualCueCount}/${res.objectiveChecks.expectedCueCount} orig=${res.objectiveChecks.originalPreservedPct}% timing=${res.objectiveChecks.timingPreservedPct}%`,
      );
      return res;
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    alignmentResults,
    liveResults,
  };

  const resolvedOut = path.resolve(process.cwd(), outPath);
  await fs.writeFile(resolvedOut, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nSaved benchmark output to ${outPath}`);

  if (alignmentResults.length > 0) {
    console.log('\n=== ALIGNMENT BENCHMARK SUMMARY ===');
    for (const a of alignmentResults) {
      console.log(
        `- ${a.id} (${a.language}): ${a.exactTargetMatches}/${a.totalExpectedTargets} (${a.associationAccuracyPct}%), estOffset=${a.estimatedOffsetMs}ms, timing=${a.timingPreservedPct}%, unmatchedBaseOk=${a.unmatchedBaseMatch}, failures=${a.failures.length}`,
      );
      for (const f of a.failures) {
        console.log(
          `    FAIL cue #${f.targetIndex} [${f.scenarioTag}]: expected base=${JSON.stringify(f.expectedBaseIndices)}, got base=${JSON.stringify(f.actualBaseIndices)} (${f.actualRelationship}, conf=${f.actualConfidence}) | target="${f.targetText}" -> base="${f.actualBaseText}"`,
        );
      }
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
