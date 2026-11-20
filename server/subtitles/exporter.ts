import {
  DEFAULT_STYLE_CONFIG,
  type AssStyleConfig,
  type SubtitleLineRole,
  type TriLineCue,
} from '../../src/types/subtitle.ts';
import { sanitizeStyleConfig } from '../validation/projectValidation.ts';

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

function pad3(n: number): string {
  return String(Math.floor(n)).padStart(3, '0');
}

function clampTimestampMs(ms: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms));
}

export function formatSrtTime(ms: number): string {
  const clamped = clampTimestampMs(ms);
  const hours = Math.floor(clamped / 3600000);
  const mins = Math.floor((clamped % 3600000) / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)},${pad3(millis)}`;
}

export function formatVttTime(ms: number): string {
  const clamped = clampTimestampMs(ms);
  const hours = Math.floor(clamped / 3600000);
  const mins = Math.floor((clamped % 3600000) / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}.${pad3(millis)}`;
}

export function formatAssTime(ms: number): string {
  const clamped = clampTimestampMs(ms);
  const hours = Math.floor(clamped / 3600000);
  const mins = Math.floor((clamped % 3600000) / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const centis = Math.floor((clamped % 1000) / 10);
  return `${hours}:${pad2(mins)}:${pad2(secs)}.${pad2(centis)}`;
}

/**
 * Converts CSS #RRGGBB hex to ASS BGR format (&HAABBGGRR).
 */
function hexToAssColor(hex: unknown, alpha = 0): string {
  if (typeof hex !== 'string') {
    return '&H00FFFFFF';
  }
  let clean = hex.replace('#', '').trim();
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return '&H00FFFFFF';
  }
  const r = clean.slice(0, 2).toUpperCase();
  const g = clean.slice(2, 4).toUpperCase();
  const b = clean.slice(4, 6).toUpperCase();
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(255, Math.round(alpha))) : 0;
  const a = safeAlpha.toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${b}${g}${r}`;
}

function getLineValue(cue: TriLineCue | null | undefined, role: SubtitleLineRole): string {
  if (!cue || typeof cue !== 'object') return '';
  const raw =
    role === 'base' ? cue.baseText : role === 'target' ? cue.targetText : cue.phoneticText;
  return typeof raw === 'string' ? raw : '';
}

function getRoleColor(style: AssStyleConfig, role: SubtitleLineRole): string {
  if (role === 'base') return style.baseColor;
  if (role === 'target') return style.targetColor;
  return style.phoneticColor;
}

function getRoleStyleName(role: SubtitleLineRole): string {
  if (role === 'base') return 'BaseLang';
  if (role === 'target') return 'TargetLang';
  return 'Phonetics';
}

function normalizeSingleLine(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function escapeAssText(text: string): string {
  return normalizeSingleLine(text)
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();
}

function escapeVttText(text: string): string {
  // WebVTT cues cannot contain literal "-->" inside payload text
  return normalizeSingleLine(text).replace(/-->/g, '—>');
}

export function generateSrtContent(cues: TriLineCue[], style: AssStyleConfig): string {
  const safeStyle = sanitizeStyleConfig(style, DEFAULT_STYLE_CONFIG);
  const safeCues = Array.isArray(cues) ? cues : [];

  const blocks = safeCues.map((cue, idx) => {
    const startMs = clampTimestampMs(cue?.startMs);
    const endMs = Math.max(startMs, clampTimestampMs(cue?.endMs));
    const start = formatSrtTime(startMs);
    const end = formatSrtTime(endMs);
    const lines = safeStyle.lineOrder
      .map((role) => {
        const text = normalizeSingleLine(getLineValue(cue, role));
        if (!text) return null;
        if (safeStyle.srtIncludeColorTags) {
          return `<font color="${getRoleColor(safeStyle, role)}">${text}</font>`;
        }
        return text;
      })
      .filter((l): l is string => Boolean(l));

    return `${idx + 1}\n${start} --> ${end}\n${lines.join('\n')}`;
  });

  const body = blocks.length > 0 ? blocks.join('\n\n') + '\n' : '';
  return safeStyle.srtIncludeBom ? `\uFEFF${body}` : body;
}

export function generateVttContent(cues: TriLineCue[], style: AssStyleConfig): string {
  const safeStyle = sanitizeStyleConfig(style, DEFAULT_STYLE_CONFIG);
  const safeCues = Array.isArray(cues) ? cues : [];

  const blocks = safeCues.map((cue, idx) => {
    const startMs = clampTimestampMs(cue?.startMs);
    const endMs = Math.max(startMs, clampTimestampMs(cue?.endMs));
    const start = formatVttTime(startMs);
    const end = formatVttTime(endMs);
    const lines = safeStyle.lineOrder
      .map((role) => {
        const text = escapeVttText(getLineValue(cue, role));
        return text || null;
      })
      .filter((l): l is string => Boolean(l));

    return `${idx + 1}\n${start} --> ${end}\n${lines.join('\n')}`;
  });

  return blocks.length > 0 ? `WEBVTT\n\n${blocks.join('\n\n')}\n` : 'WEBVTT\n\n';
}

export function generateAssContent(
  cues: TriLineCue[],
  style: AssStyleConfig,
  title: unknown = 'TriLine Studio Export',
): string {
  const safeStyle = sanitizeStyleConfig(style, DEFAULT_STYLE_CONFIG);
  const safeCues = Array.isArray(cues) ? cues : [];
  const rawTitle = typeof title === 'string' ? title : '';
  const safeTitle = rawTitle.replace(/\r?\n/g, ' ').trim() || 'TriLine Studio Export';

  const borderStyle = safeStyle.opaqueBox ? 3 : 1;
  // ASS BackColour alpha: 0 = opaque, 255 = transparent
  const backAlpha = safeStyle.opaqueBox
    ? Math.round(((100 - Math.max(0, Math.min(100, safeStyle.boxOpacity))) / 100) * 255)
    : 128;
  const backColor = hexToAssColor('#090D16', backAlpha);
  const outlineColor = safeStyle.opaqueBox ? backColor : '&H00000000';

  const basePrimary = hexToAssColor(safeStyle.baseColor, 0);
  const targetPrimary = hexToAssColor(safeStyle.targetColor, 0);
  const phoneticPrimary = hexToAssColor(safeStyle.phoneticColor, 0);

  const font = safeStyle.fontFamily || 'Plus Jakarta Sans';
  const outline = safeStyle.opaqueBox
    ? Math.max(4, safeStyle.outlineWidth + 4)
    : safeStyle.outlineWidth;
  const shadow = safeStyle.opaqueBox ? 0 : safeStyle.shadowDepth;

  const header = `[Script Info]
Title: ${safeTitle}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: BaseLang,${font},${safeStyle.baseFontSize},${basePrimary},&H000000FF,${outlineColor},${backColor},0,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${safeStyle.alignment},60,60,${safeStyle.marginV},1
Style: TargetLang,${font},${safeStyle.targetFontSize},${targetPrimary},&H000000FF,${outlineColor},${backColor},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${safeStyle.alignment},60,60,${safeStyle.marginV},1
Style: Phonetics,${font},${safeStyle.phoneticFontSize},${phoneticPrimary},&H000000FF,${outlineColor},${backColor},0,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${safeStyle.alignment},60,60,${safeStyle.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = safeCues.map((cue) => {
    const startMs = clampTimestampMs(cue?.startMs);
    const endMs = Math.max(startMs, clampTimestampMs(cue?.endMs));
    const start = formatAssTime(startMs);
    const end = formatAssTime(endMs);

    const resolvedParts: Array<{ role: SubtitleLineRole; text: string }> = [];
    for (const role of safeStyle.lineOrder) {
      const val = escapeAssText(getLineValue(cue, role));
      if (val) {
        resolvedParts.push({ role, text: val });
      }
    }

    const firstRole = resolvedParts[0]?.role || safeStyle.lineOrder[0] || 'base';
    const primaryStyle = getRoleStyleName(firstRole);
    const text = resolvedParts
      .map((part, idx) =>
        idx === 0 ? part.text : `{\\r${getRoleStyleName(part.role)}}${part.text}`,
      )
      .join('\\N');

    return `Dialogue: 0,${start},${end},${primaryStyle},,0,0,0,,${text}`;
  });

  return events.length > 0 ? `${header}\n${events.join('\n')}\n` : `${header}\n`;
}

