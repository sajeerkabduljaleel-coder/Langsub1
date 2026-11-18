import type { TriLineCue } from '../types/subtitle';

const CJK_OR_KANA_CHAR_REGEX =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

/**
 * Splits a subtitle line into highlightable tokens.
 * - Spaced languages (English, German, Arabic, Russian, Pinyin/Romaji, etc.) split on whitespace while preserving internal hyphens cleanly or keeping hyphenated phonetic syllables clickable.
 * - Unspaced CJK strings (Japanese kana/kanji, Mandarin Hanzi, Korean without spaces) segment into character/script-cluster tokens so word-level highlighting works naturally across scripts.
 */
export function tokenizeCueWords(text: string): string[] {
  const normalized = text.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!normalized) return [];

  const spaceSplit = normalized.split(' ').filter(Boolean);
  const tokens: string[] = [];

  for (const chunk of spaceSplit) {
    if (CJK_OR_KANA_CHAR_REGEX.test(chunk) && chunk.length > 3 && !chunk.includes('-')) {
      // Group consecutive Latin/digit segments if mixed, and split CJK runs into individual glyphs
      // (attaching trailing punctuation to the preceding character).
      const chars = Array.from(chunk);
      let asciiBuffer = '';

      const flushAscii = () => {
        if (asciiBuffer) {
          tokens.push(asciiBuffer);
          asciiBuffer = '';
        }
      };

      for (const ch of chars) {
        if (CJK_OR_KANA_CHAR_REGEX.test(ch)) {
          flushAscii();
          tokens.push(ch);
        } else if (/[。、！？!?.,，；：「」『』（）()]/.test(ch) && tokens.length > 0 && !asciiBuffer) {
          tokens[tokens.length - 1] = `${tokens[tokens.length - 1]}${ch}`;
        } else if (/[\w'-]/.test(ch)) {
          asciiBuffer += ch;
        } else {
          flushAscii();
          if (tokens.length > 0) {
            tokens[tokens.length - 1] = `${tokens[tokens.length - 1]}${ch}`;
          } else {
            tokens.push(ch);
          }
        }
      }
      flushAscii();
    } else {
      tokens.push(chunk);
    }
  }

  return tokens;
}

export function getActiveWordIndex(
  tokens: string[],
  elapsedMs: number,
  durationMs: number,
): number {
  if (tokens.length === 0) return -1;
  if (durationMs <= 0) return 0;
  const clampedElapsed = Math.max(0, Math.min(durationMs - 1, elapsedMs));
  const ratio = clampedElapsed / durationMs;
  return Math.min(tokens.length - 1, Math.max(0, Math.floor(ratio * tokens.length)));
}

export function computeEffectiveCueDurationMs(
  cue: Pick<TriLineCue, 'startMs' | 'endMs'> | null | undefined,
  playbackSpeed: number,
): number {
  const safeSpeed = Math.max(0.5, Math.min(2, playbackSpeed || 1));
  const rawDuration = cue ? Math.max(600, cue.endMs - cue.startMs) : 2600;
  const boundedBase = Math.max(1200, Math.min(8000, rawDuration));
  return Math.round(boundedBase / safeSpeed);
}

export interface CueTickTransition {
  nextPhase: 'playing' | 'pausing' | 'stopped';
  nextCueIndex: number;
  nextElapsedMs: number;
  nextPauseRemainingMs: number;
}

export function resolveCueTickCompletion(params: {
  currentIndex: number;
  totalCues: number;
  repeatCurrentCue: boolean;
  pauseBetweenCuesMs: number;
}): CueTickTransition {
  const { currentIndex, totalCues, repeatCurrentCue, pauseBetweenCuesMs } = params;
  if (totalCues <= 0) {
    return {
      nextPhase: 'stopped',
      nextCueIndex: 0,
      nextElapsedMs: 0,
      nextPauseRemainingMs: 0,
    };
  }

  const normalizedPause = Math.max(0, Math.round(pauseBetweenCuesMs || 0));

  if (repeatCurrentCue) {
    if (normalizedPause > 0) {
      return {
        nextPhase: 'pausing',
        nextCueIndex: currentIndex,
        nextElapsedMs: 0,
        nextPauseRemainingMs: normalizedPause,
      };
    }
    return {
      nextPhase: 'playing',
      nextCueIndex: currentIndex,
      nextElapsedMs: 0,
      nextPauseRemainingMs: 0,
    };
  }

  if (currentIndex + 1 >= totalCues) {
    return {
      nextPhase: 'stopped',
      nextCueIndex: currentIndex,
      nextElapsedMs: 0,
      nextPauseRemainingMs: 0,
    };
  }

  if (normalizedPause > 0) {
    return {
      nextPhase: 'pausing',
      nextCueIndex: currentIndex + 1,
      nextElapsedMs: 0,
      nextPauseRemainingMs: normalizedPause,
    };
  }

  return {
    nextPhase: 'playing',
    nextCueIndex: currentIndex + 1,
    nextElapsedMs: 0,
    nextPauseRemainingMs: 0,
  };
}
