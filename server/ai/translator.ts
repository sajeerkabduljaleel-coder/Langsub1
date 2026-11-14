import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AlignmentRelationship,
  ConversionMode,
  PhoneticStyle,
  TriLineCue,
} from '../../src/types/subtitle.ts';
import {
  buildLineCacheKey,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_PROMPT_VERSION,
  getCachedLine,
  setCachedLines,
} from '../db/store.ts';

export const GEMINI_TRANSLATION_MODEL = DEFAULT_GEMINI_MODEL;
export const TRANSLATION_PROMPT_VERSION = DEFAULT_PROMPT_VERSION;

const BATCH_SIZE = 20;
const MAX_RETRIES = 3;

// Unicode ranges / symbols strictly belonging to IPA that must NOT appear in English intuitive phonetics
const IPA_FORBIDDEN_REGEX =
  /[ɪʃθðŋəɛɔʊʌʒʔˈˌːæɑɒɜɝɾɲʎɕʑɯɤɨʉʁχβɣɸʋɦɬɮʈɖɳʂʐɻ]/;

// Non-Latin scripts that must NEVER leak into English-intuitive phonetic lines
const NON_LATIN_SCRIPT_REGEX =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0900-\u097f]/;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please verify your API key in Settings > Secrets.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getLanguagePhoneticRules(targetLang: string): string {
  const lower = targetLang.toLowerCase();
  if (lower.includes('german')) {
    return 'German rules: ch after a/o/u/au = "kh" (ich = "ikh"); sch = "sh"; sp/st at start = "shp/sht"; ei = "eye"; eu/äu = "oy"; ie = "ee"; v = "f"; w = "v"; z = "ts"; final b/d/g devoiced to p/t/k.';
  }
  if (lower.includes('japanese')) {
    return 'Japanese rules: clear syllables (koh-nee-chee-wah); long vowels doubled or marked cleanly (oh, oo, eh); final -u in desu/masu often soft/elided (dess, mahss); r = crisp light r.';
  }
  if (lower.includes('spanish')) {
    return 'Spanish rules: ll = "y"; ñ = "ny"; j/ge/gi = "kh/h"; qu = "k"; h is silent; soft intervocalic d = light "th/d"; clear vowels (a=ah, e=eh, i=ee, o=oh, u=oo).';
  }
  if (lower.includes('french')) {
    return 'French rules: account for spoken liaisons and silent final consonants; nasal vowels written naturally like "oh(n)", "ah(n)", "eh(n)"; u = "ew"; ou = "oo"; j = "zh"; qu = "k".';
  }
  if (lower.includes('korean')) {
    return 'Korean rules: account for batchim consonant assimilation between syllables; eo = "uh"; eu = "eu"; ae/e = "eh"; si = "shee"; crisp syllable breaks.';
  }
  if (lower.includes('mandarin') || lower.includes('chinese')) {
    return 'Mandarin rules: convert pinyin/characters into English-intuitive sounds: zh="j", q="ch", x="sh", c="ts", z="dz", ü="ew"; natural syllable breaks.';
  }
  if (lower.includes('italian')) {
    return 'Italian rules: c before e/i = "ch", ch = "k"; g before e/i = "j", gh = "g"; gl = "ly"; gn = "ny"; sc before e/i = "sh"; clear vowels.';
  }
  return 'Use intuitive English spelling rules consistently: ah, eh, ee, oh, oo, kh, zh, sh, ch, ny. Never use IPA symbols.';
}

function buildSystemInstruction(params: {
  mode: ConversionMode;
  baseLang: string;
  targetLang: string;
  phoneticStyle: PhoneticStyle;
}): string {
  const styleDesc =
    params.phoneticStyle === 'hyphenated'
      ? 'Separate multi-syllable words with hyphens and capitalize the primary stressed syllable in each word, e.g. "ikh fer-SHTAY-uh nikht".'
      : 'Use smooth, easy-to-read natural English-phonetic word spacing with gentle stress capitalization only where helpful, e.g. "ikh fer-shtay-uh nikht".';

  const modeTask =
    params.mode === 'target-first'
      ? `Each input cue provides "targetText" in ${params.targetLang}. Preserve "targetText" faithfully, translate it into natural conversational ${params.baseLang} for "baseText", and generate intuitive English-reader phonetics of "targetText" for "phoneticText".`
      : params.mode === 'base-first'
        ? `Each input cue provides "baseText" in ${params.baseLang} (and possibly "targetText" if already matched). Preserve "baseText", translate into natural spoken movie-dialogue ${params.targetLang} for "targetText" (if empty), and generate intuitive English-reader phonetics of "targetText" for "phoneticText".`
        : `Each input cue provides authentic "targetText" in ${params.targetLang} and/or paired "baseText" in ${params.baseLang} (translate any missing side naturally from the provided side). Preserve all provided dialogue faithfully and generate intuitive English-reader phonetics of "targetText" for "phoneticText".`;

  return [
    'You are an expert bilingual cinema subtitler and applied phonetics specialist.',
    modeTask,
    'PHONETIC & OUTPUT RULES (CRITICAL):',
    '1. NEVER output International Phonetic Alphabet (IPA) symbols, slash delimiters (/.../), or non-Latin characters in "phoneticText".',
    `2. ${styleDesc}`,
    `3. ${getLanguagePhoneticRules(params.targetLang)}`,
    '4. Account for contextual pronunciation, contractions, elisions, and natural spoken cadence.',
    '5. Keep lines concise and faithful to film dialogue without adding commentary or brackets.',
    '6. Return EXACTLY one non-empty JSON item per input cue with matching numeric "index".',
    '7. Maintain consistent phonetic spelling for recurring words, names, and expressions matching any entries in readOnlyConsistencyGlossary.',
  ].join('\n');
}

export interface BatchInputCue {
  index: number;
  startMs: number;
  endMs: number;
  baseText: string;
  targetText: string;
  alignmentConfidence?: number;
  alignmentRelationship?: AlignmentRelationship;
}

interface GeminiBatchItem {
  index: number;
  baseText: string;
  targetText: string;
  phoneticText: string;
}

export type GenerateBatchPayloadFn = (args: {
  model: string;
  systemInstruction: string;
  contents: string;
}) => Promise<string>;

async function defaultGenerateWithGemini(
  ai: GoogleGenAI,
  args: { model: string; systemInstruction: string; contents: string },
): Promise<string> {
  const response = await ai.models.generateContent({
    model: args.model,
    contents: args.contents,
    config: {
      systemInstruction: args.systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                baseText: { type: Type.STRING },
                targetText: { type: Type.STRING },
                phoneticText: { type: Type.STRING },
              },
              required: ['index', 'baseText', 'targetText', 'phoneticText'],
            },
          },
        },
        required: ['items'],
      },
    },
  });
  return response.text ?? '';
}

function validateAndNormalizeBatchItems(
  rawText: string,
  batch: BatchInputCue[],
): GeminiBatchItem[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('Empty response returned from Gemini API.');
  }

  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(trimmed) as { items?: unknown };
  } catch {
    throw new Error('Malformed JSON returned from Gemini API.');
  }

  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('Malformed JSON schema returned from Gemini API (missing items array).');
  }

  const expectedIndices = new Set(batch.map((c) => c.index));
  const byIndex = new Map<number, GeminiBatchItem>();

  for (const rawItem of parsed.items) {
    if (!rawItem || typeof rawItem !== 'object') {
      throw new Error('Malformed item object returned from Gemini API.');
    }
    const item = rawItem as Partial<GeminiBatchItem>;
    if (typeof item.index !== 'number' || !Number.isInteger(item.index)) {
      throw new Error('Malformed cue index returned from Gemini API.');
    }
    if (!expectedIndices.has(item.index)) {
      throw new Error(`Unexpected cue index ${item.index} returned from Gemini API.`);
    }
    if (byIndex.has(item.index)) {
      throw new Error(`Duplicate cue index ${item.index} returned from Gemini API.`);
    }

    const rawPhonetic = typeof item.phoneticText === 'string' ? item.phoneticText.trim() : '';
    if (!rawPhonetic) {
      throw new Error(`Empty phoneticText returned for cue ${item.index}`);
    }
    if (/^\/.*\/$/.test(rawPhonetic)) {
      throw new Error(`Slash-delimited IPA notation detected in phonetic output for cue ${item.index}`);
    }
    if (IPA_FORBIDDEN_REGEX.test(rawPhonetic)) {
      throw new Error(`IPA character detected in phonetic output for cue ${item.index}`);
    }
    if (NON_LATIN_SCRIPT_REGEX.test(rawPhonetic)) {
      throw new Error(`Non-Latin script leaked into phonetic output for cue ${item.index}`);
    }

    byIndex.set(item.index, {
      index: item.index,
      baseText: typeof item.baseText === 'string' ? item.baseText.trim() : '',
      targetText: typeof item.targetText === 'string' ? item.targetText.trim() : '',
      phoneticText: rawPhonetic,
    });
  }

  if (byIndex.size !== batch.length) {
    const missing = batch.filter((c) => !byIndex.has(c.index)).map((c) => c.index);
    throw new Error(`Missing output item(s) for cue index: ${missing.join(', ')}`);
  }

  return batch.map((orig) => {
    const matched = byIndex.get(orig.index)!;
    // Strictly preserve any original dialogue already provided
    const finalBase = orig.baseText.trim() ? orig.baseText : matched.baseText;
    const finalTarget = orig.targetText.trim() ? orig.targetText : matched.targetText;
    const finalPhonetic = matched.phoneticText;

    if (!finalBase) {
      throw new Error(`Empty baseText returned for cue ${orig.index}`);
    }
    if (!finalTarget) {
      throw new Error(`Empty targetText returned for cue ${orig.index}`);
    }
    if (!finalPhonetic) {
      throw new Error(`Empty phoneticText returned for cue ${orig.index}`);
    }

    return {
      index: orig.index,
      baseText: finalBase,
      targetText: finalTarget,
      phoneticText: finalPhonetic,
    };
  });
}

async function callGeminiBatchWithRetry(
  generateFn: GenerateBatchPayloadFn,
  systemInstruction: string,
  batch: BatchInputCue[],
  contextBefore: BatchInputCue[],
  consistencyGlossary: Array<{ targetText: string; phoneticText: string }>,
  retryDelayBaseMs = 800,
): Promise<GeminiBatchItem[]> {
  const promptPayload = {
    readOnlyPrecedingContext: contextBefore.map((c) => ({
      baseText: c.baseText,
      targetText: c.targetText,
    })),
    readOnlyConsistencyGlossary: consistencyGlossary,
    cuesToProcess: batch.map((c) => ({
      index: c.index,
      baseText: c.baseText,
      targetText: c.targetText,
    })),
  };

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const rawText = await generateFn({
        model: GEMINI_TRANSLATION_MODEL,
        systemInstruction,
        contents: JSON.stringify(promptPayload),
      });

      return validateAndNormalizeBatchItems(rawText, batch);
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Do not retry hard auth/config errors
      if (
        msg.includes('API_KEY_INVALID') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('403') ||
        msg.includes('401') ||
        msg.includes('NOT_FOUND')
      ) {
        throw err;
      }
      if (attempt < MAX_RETRIES - 1 && retryDelayBaseMs > 0) {
        const delayMs =
          retryDelayBaseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Gemini batch processing failed after retries.');
}

export interface ProgressSnapshot {
  processedCues: number;
  totalCues: number;
  cacheHits: number;
  apiBatchesCompleted: number;
  apiBatchesTotal: number;
  estimatedRemainingSec: number;
}

function getCueLineCacheParams(
  cue: BatchInputCue,
  params: {
    mode: ConversionMode;
    baseLang: string;
    targetLang: string;
    phoneticStyle: PhoneticStyle;
  },
) {
  return {
    mode: params.mode,
    baseLang: params.baseLang,
    targetLang: params.targetLang,
    phoneticStyle: params.phoneticStyle,
    sourcePrimary: params.mode === 'base-first' ? cue.baseText : cue.targetText,
    sourceSecondary:
      params.mode === 'dual-merge'
        ? cue.baseText
        : params.mode === 'base-first'
          ? cue.targetText
          : '',
    model: GEMINI_TRANSLATION_MODEL,
    promptVersion: TRANSLATION_PROMPT_VERSION,
  };
}

export async function processTriLineConversion(params: {
  cues: BatchInputCue[];
  mode: ConversionMode;
  baseLang: string;
  targetLang: string;
  phoneticStyle: PhoneticStyle;
  skipLineCache?: boolean;
  onProgress: (progress: ProgressSnapshot) => void;
  generateBatchFn?: GenerateBatchPayloadFn;
  retryDelayBaseMs?: number;
}): Promise<{ cues: TriLineCue[]; cacheHits: number }> {
  const totalCues = params.cues.length;
  const results: Array<TriLineCue | null> = new Array(totalCues).fill(null);
  const uncachedIndices: number[] = [];
  let cacheHits = 0;

  // Track project-wide phonetic consistency pairs across cache hits and batches
  const glossaryMap = new Map<string, string>();
  const addGlossaryPair = (targetText: string, phoneticText: string) => {
    const t = targetText.trim();
    const p = phoneticText.trim();
    if (!t || !p) return;
    glossaryMap.set(t, p);
    if (glossaryMap.size > 24) {
      const oldestKey = glossaryMap.keys().next().value;
      if (oldestKey !== undefined) glossaryMap.delete(oldestKey);
    }
  };

  // Step 1: Check persistent line-level cache
  for (let i = 0; i < totalCues; i++) {
    const cue = params.cues[i];
    const cacheKey = buildLineCacheKey(getCueLineCacheParams(cue, params));

    if (!params.skipLineCache) {
      const cached = await getCachedLine(cacheKey);
      if (
        cached &&
        cached.baseText &&
        cached.targetText &&
        cached.phoneticText &&
        !IPA_FORBIDDEN_REGEX.test(cached.phoneticText) &&
        !NON_LATIN_SCRIPT_REGEX.test(cached.phoneticText)
      ) {
        const finalBase = cue.baseText.trim() ? cue.baseText : cached.baseText;
        const finalTarget = cue.targetText.trim() ? cue.targetText : cached.targetText;
        results[i] = {
          id: `cue-${cue.index}`,
          index: cue.index,
          startMs: cue.startMs,
          endMs: cue.endMs,
          baseText: finalBase,
          targetText: finalTarget,
          phoneticText: cached.phoneticText,
          ...(typeof cue.alignmentConfidence === 'number'
            ? { alignmentConfidence: cue.alignmentConfidence }
            : {}),
          ...(cue.alignmentRelationship
            ? { alignmentRelationship: cue.alignmentRelationship }
            : {}),
          cacheHit: true,
        };
        addGlossaryPair(finalTarget, cached.phoneticText);
        cacheHits++;
        continue;
      }
    }

    uncachedIndices.push(i);
  }

  const totalBatches = Math.ceil(uncachedIndices.length / BATCH_SIZE);
  params.onProgress({
    processedCues: cacheHits,
    totalCues,
    cacheHits,
    apiBatchesCompleted: 0,
    apiBatchesTotal: totalBatches,
    estimatedRemainingSec: totalBatches * 3,
  });

  if (uncachedIndices.length > 0) {
    const generateFn: GenerateBatchPayloadFn =
      params.generateBatchFn ||
      ((ai => (args) => defaultGenerateWithGemini(ai, args))(getAiClient()));

    const systemInstruction = buildSystemInstruction({
      mode: params.mode,
      baseLang: params.baseLang,
      targetLang: params.targetLang,
      phoneticStyle: params.phoneticStyle,
    });

    const batchDurations: number[] = [];

    for (let bStart = 0; bStart < uncachedIndices.length; bStart += BATCH_SIZE) {
      const batchSlotIndices = uncachedIndices.slice(bStart, bStart + BATCH_SIZE);
      const batchInput = batchSlotIndices.map((idx) => params.cues[idx]);

      const firstIdx = batchSlotIndices[0];
      const contextBefore = params.cues.slice(Math.max(0, firstIdx - 2), firstIdx);
      const glossaryEntries = Array.from(glossaryMap.entries()).map(
        ([targetText, phoneticText]) => ({ targetText, phoneticText }),
      );

      const batchNum = Math.floor(bStart / BATCH_SIZE) + 1;
      const startedAt = Date.now();
      let generated: GeminiBatchItem[];

      try {
        generated = await callGeminiBatchWithRetry(
          generateFn,
          systemInstruction,
          batchInput,
          contextBefore,
          glossaryEntries,
          params.retryDelayBaseMs ?? 800,
        );
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        const completedCount = batchNum - 1;
        throw new Error(
          `Batch ${batchNum}/${totalBatches} failed: ${reason}${
            completedCount > 0
              ? ` (${completedCount} completed batch(es) remain safely cached.)`
              : ''
          }`,
        );
      }

      batchDurations.push((Date.now() - startedAt) / 1000);

      const cacheWrites: Array<{
        key: string;
        value: { baseText: string; targetText: string; phoneticText: string; updatedAt: string };
      }> = [];

      for (let j = 0; j < batchSlotIndices.length; j++) {
        const slotIdx = batchSlotIndices[j];
        const orig = params.cues[slotIdx];
        const gen = generated[j];

        const triCue: TriLineCue = {
          id: `cue-${orig.index}`,
          index: orig.index,
          startMs: orig.startMs,
          endMs: orig.endMs,
          baseText: gen.baseText,
          targetText: gen.targetText,
          phoneticText: gen.phoneticText,
          ...(typeof orig.alignmentConfidence === 'number'
            ? { alignmentConfidence: orig.alignmentConfidence }
            : {}),
          ...(orig.alignmentRelationship
            ? { alignmentRelationship: orig.alignmentRelationship }
            : {}),
          cacheHit: false,
        };
        results[slotIdx] = triCue;
        addGlossaryPair(triCue.targetText, triCue.phoneticText);

        const cacheKey = buildLineCacheKey(getCueLineCacheParams(orig, params));
        cacheWrites.push({
          key: cacheKey,
          value: {
            baseText: triCue.baseText,
            targetText: triCue.targetText,
            phoneticText: triCue.phoneticText,
            updatedAt: new Date().toISOString(),
          },
        });
      }

      await setCachedLines(cacheWrites);

      const avgBatchSec =
        batchDurations.reduce((a, b) => a + b, 0) / batchDurations.length;
      const remainingBatches = Math.max(0, totalBatches - batchNum);

      params.onProgress({
        processedCues: Math.min(totalCues, cacheHits + bStart + batchSlotIndices.length),
        totalCues,
        cacheHits,
        apiBatchesCompleted: batchNum,
        apiBatchesTotal: totalBatches,
        estimatedRemainingSec: Math.round(remainingBatches * avgBatchSec),
      });
    }
  }

  const finalCues = results.filter((c): c is TriLineCue => c !== null);
  if (finalCues.length !== totalCues) {
    throw new Error(
      `Cue count mismatch after conversion: expected ${totalCues}, got ${finalCues.length}.`,
    );
  }
  return { cues: finalCues, cacheHits };
}
