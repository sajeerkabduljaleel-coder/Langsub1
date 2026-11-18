import type {
  AssStyleConfig,
  SubtitleLineRole,
  TriLineCue,
} from '../../src/types/subtitle.ts';

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0');
}

function pad3(n: number): string {
  return String(Math.floor(n)).padStart(3, '0');
}

export function formatSrtTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3600000);
  const mins = Math.floor((clamped % 3600000) / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)},${pad3(millis)}`;
}

export function formatVttTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3600000);
  const mins = Math.floor((clamped % 3600000) / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}.${pad3(millis)}`;
}

export function formatAssTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3600000);
  const mins = Math.floor((clamped % 3600000) / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const centis = Math.floor((clamped % 1000) / 10);
  return `${hours}:${pad2(mins)}:${pad2(secs)}.${pad2(centis)}`;
}

/**
 * Converts CSS #RRGGBB hex to ASS BGR format (&HAABBGGRR).
 */
function hexToAssColor(hex: string, alpha = 0): string {
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
  const a = Math.max(0, Math.min(255, Math.round(alpha)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `&H${a}${b}${g}${r}`;
}

function getLineValue(cue: TriLineCue, role: SubtitleLineRole): string {
  if (role === 'base') return cue.baseText;
  if (role === 'target') return cue.targetText;
  return cue.phoneticText;
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

function escapeAssText(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();
}

export function generateSrtContent(cues: TriLineCue[], style: AssStyleConfig): string {
  const blocks = cues.map((cue, idx) => {
    const start = formatSrtTime(cue.startMs);
    const end = formatSrtTime(cue.endMs);
    const lines = style.lineOrder
      .map((role) => {
        const text = getLineValue(cue, role).replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (!text) return null;
        if (style.srtIncludeColorTags) {
          return `<font color="${getRoleColor(style, role)}">${text}</font>`;
        }
        return text;
      })
      .filter((l): l is string => Boolean(l));

    return `${idx + 1}\n${start} --> ${end}\n${lines.join('\n')}`;
  });

  const body = blocks.join('\n\n') + '\n';
  return style.srtIncludeBom ? `\uFEFF${body}` : body;
}

export function generateVttContent(cues: TriLineCue[], style: AssStyleConfig): string {
  const blocks = cues.map((cue, idx) => {
    const start = formatVttTime(cue.startMs);
    const end = formatVttTime(cue.endMs);
    const lines = style.lineOrder
      .map((role) => {
        const text = getLineValue(cue, role).replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
        return text || null;
      })
      .filter((l): l is string => Boolean(l));

    return `${idx + 1}\n${start} --> ${end}\n${lines.join('\n')}`;
  });

  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

export function generateAssContent(
  cues: TriLineCue[],
  style: AssStyleConfig,
  title = 'TriLine Studio Export',
): string {
  const safeTitle = title.replace(/\r?\n/g, ' ').trim() || 'TriLine Studio Export';
  const borderStyle = style.opaqueBox ? 3 : 1;
  // ASS BackColour alpha: 0 = opaque, 255 = transparent
  const backAlpha = style.opaqueBox
    ? Math.round(((100 - Math.max(0, Math.min(100, style.boxOpacity))) / 100) * 255)
    : 128;
  const backColor = hexToAssColor('#090D16', backAlpha);
  const outlineColor = style.opaqueBox ? backColor : '&H00000000';

  const basePrimary = hexToAssColor(style.baseColor, 0);
  const targetPrimary = hexToAssColor(style.targetColor, 0);
  const phoneticPrimary = hexToAssColor(style.phoneticColor, 0);

  const font = style.fontFamily || 'Plus Jakarta Sans';
  const outline = style.opaqueBox ? Math.max(4, style.outlineWidth + 4) : style.outlineWidth;
  const shadow = style.opaqueBox ? 0 : style.shadowDepth;

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
Style: BaseLang,${font},${style.baseFontSize},${basePrimary},&H000000FF,${outlineColor},${backColor},0,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${style.alignment},60,60,${style.marginV},1
Style: TargetLang,${font},${style.targetFontSize},${targetPrimary},&H000000FF,${outlineColor},${backColor},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${style.alignment},60,60,${style.marginV},1
Style: Phonetics,${font},${style.phoneticFontSize},${phoneticPrimary},&H000000FF,${outlineColor},${backColor},0,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${style.alignment},60,60,${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = cues.map((cue) => {
    const start = formatAssTime(cue.startMs);
    const end = formatAssTime(cue.endMs);

    const segments = style.lineOrder
      .map((role, orderIdx) => {
        const val = escapeAssText(getLineValue(cue, role));
        if (!val) return null;
        const styleName = getRoleStyleName(role);
        if (orderIdx === 0) {
          return val;
        }
        return `{\\r${styleName}}${val}`;
      })
      .filter((s): s is string => Boolean(s));

    const firstRole = style.lineOrder[0] || 'base';
    const primaryStyle = getRoleStyleName(firstRole);
    const text = segments.join('\\N');

    return `Dialogue: 0,${start},${end},${primaryStyle},,0,0,0,,${text}`;
  });

  return `${header}\n${events.join('\n')}\n`;
}
