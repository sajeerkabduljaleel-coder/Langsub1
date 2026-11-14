import crypto from 'node:crypto';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import type {
  ParsedSubtitleResult,
  ProcessingOptions,
  ProcessingReport,
  RawCue,
  SubtitleFormat,
} from '../../src/types/subtitle.ts';

function normalizeEncodingName(detected: string | null | undefined): string {
  if (!detected) return 'UTF-8';
  const upper = detected.toUpperCase();
  if (upper === 'ASCII' || upper === 'US-ASCII') return 'UTF-8';
  if (upper.includes('UTF-8') || upper === 'UTF8') return 'UTF-8';
  if (upper.includes('UTF-16LE') || upper === 'UTF16LE') return 'UTF-16LE';
  if (upper.includes('UTF-16BE') || upper === 'UTF16BE') return 'UTF-16BE';
  if (upper === 'ISO-8859-1' || upper === 'LATIN1') return 'windows-1252';
  if (upper === 'SHIFT_JIS' || upper === 'SHIFT-JIS' || upper === 'SJIS') return 'Shift_JIS';
  return detected;
}

function detectBomlessUtf16(buffer: Buffer): 'UTF-16LE' | 'UTF-16BE' | null {
  if (buffer.length < 4 || buffer.length % 2 !== 0) return null;
  const sampleLen = Math.min(buffer.length, 512);
  let evenNulls = 0;
  let oddNulls = 0;
  const pairs = Math.floor(sampleLen / 2);
  for (let i = 0; i < pairs * 2; i += 2) {
    if (buffer[i] === 0x00) evenNulls++;
    if (buffer[i + 1] === 0x00) oddNulls++;
  }
  const evenRatio = evenNulls / pairs;
  const oddRatio = oddNulls / pairs;
  if (oddRatio >= 0.2 && evenRatio <= 0.05) return 'UTF-16LE';
  if (evenRatio >= 0.2 && oddRatio <= 0.05) return 'UTF-16BE';
  return null;
}

export function decodeBufferWithDetection(buffer: Buffer): {
  text: string;
  detectedEncoding: string;
} {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      text: buffer.subarray(3).toString('utf8'),
      detectedEncoding: 'UTF-8 (BOM)',
    };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      text: iconv.decode(buffer.subarray(2), 'UTF-16LE'),
      detectedEncoding: 'UTF-16LE (BOM)',
    };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return {
      text: iconv.decode(buffer.subarray(2), 'UTF-16BE'),
      detectedEncoding: 'UTF-16BE (BOM)',
    };
  }

  // Detect BOM-less UTF-16 before UTF-8 / chardet checks
  const bomlessUtf16 = detectBomlessUtf16(buffer);
  if (bomlessUtf16) {
    return {
      text: iconv.decode(buffer, bomlessUtf16),
      detectedEncoding: bomlessUtf16,
    };
  }

  // Strictly validate UTF-8 first so short UTF-8 inputs with accents/umlauts
  // are never misclassified by chardet as ISO-8859-1 / windows-1252.
  try {
    const strictUtf8 = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { text: strictUtf8, detectedEncoding: 'UTF-8' };
  } catch {
    // Not valid UTF-8 — fall through to chardet + iconv legacy decoding
  }

  const rawDetected = chardet.detect(buffer);
  const normalized = normalizeEncodingName(rawDetected);

  if (normalized === 'UTF-8') {
    return {
      text: iconv.decode(buffer, 'windows-1252'),
      detectedEncoding: 'windows-1252 (fallback)',
    };
  }

  if (iconv.encodingExists(normalized)) {
    return {
      text: iconv.decode(buffer, normalized),
      detectedEncoding: rawDetected || normalized,
    };
  }

  return {
    text: iconv.decode(buffer, 'windows-1252'),
    detectedEncoding: rawDetected ? `${rawDetected} (windows-1252 fallback)` : 'windows-1252 (fallback)',
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function repairMalformedCharacters(input: string): string {
  return decodeHtmlEntities(input)
    .replace(/^\uFEFF/, '')
    .replace(/\u200B/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function stripFormattingTags(input: string, preserveTags: boolean): string {
  let out = input
    .replace(/\{\\[^}]*\}/g, '') // ASS override tags like {\an8}, {\i1}, {\pos(x,y)}
    .replace(/\\N|\\n/g, '\n')
    .replace(/\\h/g, ' ');

  if (!preserveTags) {
    out = out
      .replace(/<\/?(?:i|b|u|s|font|c|v|lang|ruby|rt)[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '');
  }
  return out;
}

function stripSdhAnnotations(input: string): { text: string; hadSdh: boolean } {
  const before = input;
  let cleaned = input
    // Bracketed / parenthesized sound effects or speaker cues: [MUSIC PLAYING], (SIGHS)
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\((?:[^()]{1,80})\)/g, '')
    // Musical note lines or symbols
    .replace(/[♪♫]+/g, '')
    // Leading ALL-CAPS speaker prefixes (including Latin accented names like ÉLODIE:, MÜLLER:)
    .replace(
      /^(?=[A-ZÀ-ÖØ-Þ0-9 .'-]*[A-ZÀ-ÖØ-Þ])[A-ZÀ-ÖØ-Þ0-9][A-ZÀ-ÖØ-Þ0-9 .'-]{0,24}:(?:\s+|$)/gm,
      '',
    )
    .replace(/^[ \t-]+$/gm, '');

  cleaned = cleaned
    .split('\n')
    .map((line) => line.replace(/\s{2,}/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();

  return {
    text: cleaned,
    hadSdh: cleaned !== before.trim(),
  };
}

function smartMergeLines(input: string): { text: string; merged: boolean } {
  const lines = input
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return { text: lines[0] || '', merged: false };
  }

  // Handle dialogue dashes like "- Hello\n- Hi" -> clean join
  const hasDialogueDashes = lines.every((l) => /^[-–—]\s*/.test(l));
  if (hasDialogueDashes) {
    return {
      text: lines.join(' '),
      merged: true,
    };
  }

  // CJK characters don't need spaces between wrapped lines
  const isCjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(input);
  return {
    text: lines.join(isCjk ? '' : ' ').replace(/\s{2,}/g, ' ').trim(),
    merged: true,
  };
}

function parseTimestampMs(raw: string): number | null {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hours = Number(parts[0]);
    const mins = Number(parts[1]);
    const [secStr, fracStr = '0'] = parts[2].split('.');
    const secs = Number(secStr);
    const ms = Number(fracStr.padEnd(3, '0').slice(0, 3));
    if ([hours, mins, secs, ms].some((n) => Number.isNaN(n) || n < 0)) return null;
    return Math.round(((hours * 3600 + mins * 60 + secs) * 1000) + ms);
  }
  if (parts.length === 2) {
    const mins = Number(parts[0]);
    const [secStr, fracStr = '0'] = parts[1].split('.');
    const secs = Number(secStr);
    const ms = Number(fracStr.padEnd(3, '0').slice(0, 3));
    if ([mins, secs, ms].some((n) => Number.isNaN(n) || n < 0)) return null;
    return Math.round(((mins * 60 + secs) * 1000) + ms);
  }
  return null;
}

export function detectSubtitleFormat(filename: string, content: string): SubtitleFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.vtt')) return 'vtt';
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) return 'ass';
  if (lower.endsWith('.srt')) return 'srt';

  const head = content.slice(0, 600).trimStart();
  if (head.startsWith('WEBVTT')) return 'vtt';
  if (/\[Script Info\]|\[V4\+? Styles\]|Dialogue:/i.test(head)) return 'ass';
  return 'srt';
}

function parseSrtOrVtt(content: string, format: 'srt' | 'vtt'): RawCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: RawCue[] = [];
  let seq = 1;

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);

    if (lines.length === 0) continue;

    // Skip WebVTT header / NOTE / STYLE / REGION blocks
    if (format === 'vtt') {
      const first = lines[0].trim();
      if (
        first.startsWith('WEBVTT') ||
        first.startsWith('NOTE') ||
        first.startsWith('STYLE') ||
        first.startsWith('REGION')
      ) {
        continue;
      }
    }

    const timingLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingLineIdx === -1) continue;

    const timingLine = lines[timingLineIdx];
    const arrowParts = timingLine.split('-->');
    if (arrowParts.length !== 2) continue;

    const startMs = parseTimestampMs(arrowParts[0].trim());
    // VTT cues may have trailing settings like "00:01:02.000 align:start position:0%"
    const endToken = arrowParts[1].trim().split(/\s+/)[0];
    const endMs = parseTimestampMs(endToken);

    if (startMs === null || endMs === null || endMs < startMs) continue;

    const textLines = lines.slice(timingLineIdx + 1);
    const rawText = textLines.join('\n').trim();
    if (!rawText) continue;

    cues.push({
      index: seq++,
      startMs,
      endMs: Math.max(endMs, startMs + 200),
      text: rawText,
      originalText: rawText,
    });
  }

  return cues;
}

function parseAss(content: string): RawCue[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let inEvents = false;
  let formatFields: string[] = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
  const cues: RawCue[] = [];
  let seq = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;

    if (line.startsWith('[')) {
      inEvents = /^\[Events\]$/i.test(line);
      continue;
    }

    if (!inEvents) continue;

    if (/^Format:/i.test(line)) {
      formatFields = line
        .slice(7)
        .split(',')
        .map((f) => f.trim());
      continue;
    }

    if (/^Dialogue:/i.test(line)) {
      const payload = line.slice(9).trim();
      const parts = payload.split(',');
      if (parts.length < formatFields.length) continue;

      const startIdx = formatFields.findIndex((f) => f.toLowerCase() === 'start');
      const endIdx = formatFields.findIndex((f) => f.toLowerCase() === 'end');
      const textIdx = formatFields.findIndex((f) => f.toLowerCase() === 'text');

      if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

      const startMs = parseTimestampMs(parts[startIdx]);
      const endMs = parseTimestampMs(parts[endIdx]);
      if (startMs === null || endMs === null || endMs < startMs) continue;

      // Text field can contain commas, so join everything from textIdx onward
      const rawText = parts.slice(textIdx).join(',').trim();
      if (!rawText) continue;

      // Skip vector drawing cues ({\p1}...{\p0}) which are graphical typesetting, not dialogue
      if (/\{\\[^}]*\\p[1-9]\b[^}]*\}|^\{\\p[1-9]\b/.test(rawText)) continue;

      cues.push({
        index: seq++,
        startMs,
        endMs: Math.max(endMs, startMs + 200),
        text: rawText,
        originalText: rawText,
      });
    }
  }

  return cues;
}

export function parseSubtitleBuffer(
  buffer: Buffer,
  fileName: string,
  options: ProcessingOptions,
): ParsedSubtitleResult {
  const { text: decodedText, detectedEncoding } = decodeBufferWithDetection(buffer);
  const repaired = repairMalformedCharacters(decodedText);
  const format = detectSubtitleFormat(fileName, repaired);

  const rawCues = format === 'ass' ? parseAss(repaired) : parseSrtOrVtt(repaired, format);

  // Sort chronologically before duplicate detection so out-of-order ASS/SRT layers deduplicate accurately
  const orderedRawCues = [...rawCues].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );

  let sdhStrippedCount = 0;
  let duplicatesRemovedCount = 0;
  let mergedLineCount = 0;
  const sdhRemovedSamples: string[] = [];

  const processed: RawCue[] = [];

  for (const cue of orderedRawCues) {
    let working = stripFormattingTags(cue.text, options.preserveFormattingTags);

    if (options.removeSdh) {
      const sdhRes = stripSdhAnnotations(working);
      if (sdhRes.hadSdh) {
        sdhStrippedCount++;
        if (sdhRemovedSamples.length < 8) {
          sdhRemovedSamples.push(cue.originalText.replace(/\n/g, ' '));
        }
      }
      working = sdhRes.text;
      // If cue was purely SDH and now empty, skip only when removeSdh is enabled (tracked in report!)
      if (!working) {
        continue;
      }
    }

    if (options.mergeMultiline) {
      const mergedRes = smartMergeLines(working);
      if (mergedRes.merged) mergedLineCount++;
      working = mergedRes.text;
    } else {
      working = working.trim();
    }

    if (!working) continue;

    if (options.removeDuplicates && processed.length > 0) {
      const prev = processed[processed.length - 1];
      const normPrev = prev.text.toLowerCase().replace(/\s+/g, ' ').trim();
      const normCurr = working.toLowerCase().replace(/\s+/g, ' ').trim();
      if (normPrev === normCurr && cue.startMs - prev.endMs <= 350) {
        // Extend previous cue's end timestamp rather than losing coverage
        prev.endMs = Math.max(prev.endMs, cue.endMs);
        duplicatesRemovedCount++;
        continue;
      }
    }

    processed.push({
      index: processed.length + 1,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: working,
      originalText: cue.originalText,
    });
  }

  processed.forEach((cue, i) => {
    cue.index = i + 1;
  });

  const sourceHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

  const report: ProcessingReport = {
    detectedEncoding,
    originalFormat: format,
    totalInputCues: rawCues.length,
    sdhStrippedCount,
    duplicatesRemovedCount,
    mergedLineCount,
    finalCueCount: processed.length,
    sdhRemovedSamples,
  };

  return {
    cues: processed,
    report,
    sourceHash,
    fileName,
  };
}
