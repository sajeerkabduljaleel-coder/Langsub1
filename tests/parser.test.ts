import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { parseSubtitleBuffer } from '../server/subtitles/parser.ts';
import { DEFAULT_PROCESSING_OPTIONS, type ProcessingOptions } from '../src/types/subtitle.ts';

describe('Subtitle Parser & Encoding Detection', () => {
  it('parses German SRT in UTF-8 without mojibake even on short inputs', () => {
    const srt = [
      '1',
      '00:00:01,250 --> 00:00:04,500',
      'Könnten Sie bitte etwas langsamer sprechen?',
      '',
      '2',
      '00:00:05,000 --> 00:00:08,125',
      'Ich möchte einen großen Kaffee, bitte!',
      '',
    ].join('\n');

    const res = parseSubtitleBuffer(Buffer.from(srt, 'utf8'), 'german.srt', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(res.report.originalFormat, 'srt');
    assert.equal(res.report.detectedEncoding, 'UTF-8');
    assert.equal(res.cues.length, 2);
    assert.equal(res.cues[0].startMs, 1250);
    assert.equal(res.cues[0].endMs, 4500);
    assert.equal(res.cues[0].text, 'Könnten Sie bitte etwas langsamer sprechen?');
    assert.equal(res.cues[1].text, 'Ich möchte einen großen Kaffee, bitte!');
  });

  it('detects UTF-8 BOM, UTF-16LE (BOM & BOM-less), UTF-16BE, Windows-1252, and Shift_JIS', () => {
    const french = '1\n00:00:01,000 --> 00:00:03,500\nÉlodie a laissé les clés sur la table.\n';

    // UTF-8 BOM
    const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(french, 'utf8')]);
    const resUtf8Bom = parseSubtitleBuffer(utf8Bom, 'fr_bom.srt', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(resUtf8Bom.report.detectedEncoding, 'UTF-8 (BOM)');
    assert.equal(resUtf8Bom.cues[0].text, 'Élodie a laissé les clés sur la table.');

    // UTF-16LE with BOM
    const utf16LeBom = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(french, 'UTF-16LE')]);
    const resLeBom = parseSubtitleBuffer(utf16LeBom, 'fr_le.srt', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(resLeBom.report.detectedEncoding, 'UTF-16LE (BOM)');
    assert.equal(resLeBom.cues[0].text, 'Élodie a laissé les clés sur la table.');

    // UTF-16LE without BOM
    const utf16LeNoBom = iconv.encode(french, 'UTF-16LE');
    const resLeNoBom = parseSubtitleBuffer(utf16LeNoBom, 'fr_le_nobom.srt', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(resLeNoBom.report.detectedEncoding, 'UTF-16LE');
    assert.equal(resLeNoBom.cues[0].text, 'Élodie a laissé les clés sur la table.');

    // UTF-16BE with BOM
    const utf16BeBom = Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(french, 'UTF-16BE')]);
    const resBeBom = parseSubtitleBuffer(utf16BeBom, 'fr_be.srt', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(resBeBom.report.detectedEncoding, 'UTF-16BE (BOM)');
    assert.equal(resBeBom.cues[0].text, 'Élodie a laissé les clés sur la table.');

    // Legacy Windows-1252 Spanish
    const spanishLegacy =
      '1\n00:00:02,000 --> 00:00:05,000\n¿Dónde está la estación mañana por la tarde?\n\n' +
      '2\n00:00:05,500 --> 00:00:08,500\n¡No te preocupes, llegaremos a tiempo!\n';
    const win1252Buf = iconv.encode(spanishLegacy, 'windows-1252');
    const resWin = parseSubtitleBuffer(win1252Buf, 'es_legacy.srt', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(resWin.cues.length, 2);
    assert.equal(resWin.cues[0].text, '¿Dónde está la estación mañana por la tarde?');
    assert.equal(resWin.cues[1].text, '¡No te preocupes, llegaremos a tiempo!');

    // Legacy Shift_JIS Japanese
    const jaSrt = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      'もうすぐ終点ですね。',
      '',
      '2',
      '00:00:04,500 --> 00:00:08,000',
      '傘を持ってきてよかったと本当に思います。',
      '',
      '3',
      '00:00:08,500 --> 00:00:11,500',
      '明日の朝、またここで会いましょう。',
      '',
    ].join('\n');
    const sjisBuf = iconv.encode(jaSrt, 'Shift_JIS');
    const resSjis = parseSubtitleBuffer(sjisBuf, 'ja_sjis.srt', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(resSjis.cues.length, 3);
    assert.equal(resSjis.cues[0].text, 'もうすぐ終点ですね。');
    assert.equal(resSjis.cues[2].text, '明日の朝、またここで会いましょう。');
  });

  it('parses WebVTT with headers, NOTE/STYLE blocks, cue settings, and short timestamps', () => {
    const vtt = [
      'WEBVTT - Spanish Mystery',
      '',
      'STYLE',
      '::cue { color: white; }',
      '',
      'NOTE This comment has an arrow 00:00:00.000 --> 00:00:01.000 inside it',
      '',
      '1',
      '00:02.500 --> 00:05.300 align:start position:10%',
      '¿Escuchaste lo que susurró',
      'en la estación?',
      '',
      '00:00:06.000 --> 00:00:09.120',
      'Dejó esta llave sobre la mesa.',
      '',
    ].join('\n');

    const res = parseSubtitleBuffer(Buffer.from(vtt, 'utf8'), 'mystery.vtt', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(res.report.originalFormat, 'vtt');
    assert.equal(res.cues.length, 2);
    assert.equal(res.cues[0].startMs, 2500);
    assert.equal(res.cues[0].endMs, 5300);
    assert.equal(res.cues[0].text, '¿Escuchaste lo que susurró en la estación?');
    assert.equal(res.cues[1].startMs, 6000);
    assert.equal(res.cues[1].endMs, 9120);
  });

  it('parses ASS with centiseconds, commas in dialogue, custom format order, override tags, and skips vector drawings', () => {
    const ass = [
      '[Script Info]',
      'Title: French Cinema',
      'ScriptType: v4.00+',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Text',
      'Dialogue: 0,0:00:05.05,0:00:08.50,Default,{\\an8\\i1}Bonjour, mon ami!\\NComment vas-tu?',
      'Dialogue: 0,0:00:01.20,0:00:04.00,Signs,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}',
      'Dialogue: 0,0:00:09.00,0:00:12.25,Default,C\'est vrai, n\'est-ce pas?',
      '',
    ].join('\n');

    const res = parseSubtitleBuffer(Buffer.from(ass, 'utf8'), 'cinema.ass', DEFAULT_PROCESSING_OPTIONS);
    assert.equal(res.report.originalFormat, 'ass');
    assert.equal(res.cues.length, 2);
    assert.equal(res.cues[0].startMs, 5050);
    assert.equal(res.cues[0].endMs, 8500);
    assert.equal(res.cues[0].text, 'Bonjour, mon ami! Comment vas-tu?');
    assert.equal(res.cues[1].startMs, 9000);
    assert.equal(res.cues[1].endMs, 12250);
    assert.equal(res.cues[1].text, "C'est vrai, n'est-ce pas?");
  });

  it('handles SDH removal, multiline merging (including CJK without spaces), and out-of-order duplicate detection', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:03,000',
      '[REGEN PRASSELT]',
      '',
      '2',
      '00:00:03,500 --> 00:00:06,000',
      'ÉLODIE: (seufzt tief) Bonjour,',
      'comment allez-vous?',
      '',
      '3',
      '00:00:10,000 --> 00:00:12,000',
      '♪ ♪',
      '',
      '4',
      '00:00:06,200 --> 00:00:08,500',
      'Bonjour, comment allez-vous?',
      '',
      '5',
      '00:00:13,000 --> 00:00:16,000',
      '傘を持ってきてよかったと',
      '本当に思います。',
      '',
    ].join('\n');

    const res = parseSubtitleBuffer(Buffer.from(srt, 'utf8'), 'mixed.srt', DEFAULT_PROCESSING_OPTIONS);
    // Cue 1 is purely SDH -> removed
    // Cue 3 is purely musical notes -> removed
    // Cue 2 (3500-6000) and Cue 4 (6200-8500, out of order) have identical cleaned text within 200ms -> merged to 3500-8500!
    // Cue 5 merges CJK lines without inserting a space
    assert.equal(res.cues.length, 2);
    assert.equal(res.cues[0].text, 'Bonjour, comment allez-vous?');
    assert.equal(res.cues[0].startMs, 3500);
    assert.equal(res.cues[0].endMs, 8500);
    assert.equal(res.report.duplicatesRemovedCount, 1);
    assert.equal(res.cues[1].text, '傘を持ってきてよかったと本当に思います。');
  });

  it('preserves inline <i> tags and multiline structure when options disable cleaning', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      '<i>(flüstert)</i> Hallo',
      'Welt',
      '',
    ].join('\n');

    const opts: ProcessingOptions = {
      removeSdh: false,
      mergeMultiline: false,
      removeDuplicates: false,
      preserveFormattingTags: true,
    };

    const res = parseSubtitleBuffer(Buffer.from(srt, 'utf8'), 'raw.srt', opts);
    assert.equal(res.cues.length, 1);
    assert.equal(res.cues[0].text, '<i>(flüstert)</i> Hallo\nWelt');
  });
});
