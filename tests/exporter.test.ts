import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAssTime,
  formatSrtTime,
  generateAssContent,
  generateSrtContent,
} from '../server/subtitles/exporter.ts';
import { DEFAULT_STYLE_CONFIG, type AssStyleConfig, type TriLineCue } from '../src/types/subtitle.ts';

const SAMPLE_CUES: TriLineCue[] = [
  {
    id: 'cue-1',
    index: 1,
    startMs: 1250,
    endMs: 4580,
    baseText: "I don't understand.",
    targetText: 'Ich verstehe nicht.',
    phoneticText: 'ikh fer-SHTAY-uh nikht.',
  },
  {
    id: 'cue-2',
    index: 2,
    startMs: 5000,
    endMs: 8990,
    baseText: 'Please have a safe {trip} home.',
    targetText: 'お気をつけてお帰りください。',
    phoneticText: 'oh-kee-oh tsoo-keh-teh oh-kah-eh-ree koo-dah-sye.',
  },
];

describe('Subtitle Exporter (SRT & ASS)', () => {
  it('formats SRT and ASS timestamps accurately', () => {
    assert.equal(formatSrtTime(0), '00:00:00,000');
    assert.equal(formatSrtTime(3723456), '01:02:03,456');
    assert.equal(formatAssTime(0), '0:00:00.00');
    assert.equal(formatAssTime(3723456), '1:02:03.45');
  });

  it('exports SRT with UTF-8 BOM, custom three-line ordering, and original target dialogue preserved', () => {
    const customStyle: AssStyleConfig = {
      ...DEFAULT_STYLE_CONFIG,
      lineOrder: ['target', 'phonetic', 'base'],
      srtIncludeColorTags: true,
      srtIncludeBom: true,
    };

    const srt = generateSrtContent(SAMPLE_CUES, customStyle);
    assert.ok(srt.startsWith('\uFEFF'), 'Expected UTF-8 BOM');
    assert.ok(srt.includes('00:00:01,250 --> 00:00:04,580'));
    assert.ok(
      srt.includes(
        '<font color="#FACC15">Ich verstehe nicht.</font>\n' +
          '<font color="#22D3EE">ikh fer-SHTAY-uh nikht.</font>\n' +
          '<font color="#FFFFFF">I don\'t understand.</font>',
      ),
    );
    assert.ok(srt.includes('お気をつけてお帰りください。'));
  });

  it('exports SRT without BOM or color tags when disabled', () => {
    const plainStyle: AssStyleConfig = {
      ...DEFAULT_STYLE_CONFIG,
      srtIncludeColorTags: false,
      srtIncludeBom: false,
    };
    const srt = generateSrtContent(SAMPLE_CUES, plainStyle);
    assert.ok(!srt.startsWith('\uFEFF'));
    assert.ok(!srt.includes('<font'));
    assert.ok(
      srt.includes(
        "1\n00:00:01,250 --> 00:00:04,580\nI don't understand.\nIch verstehe nicht.\nikh fer-SHTAY-uh nikht.",
      ),
    );
  });

  it('exports ASS with BGR colors, styles, escaped braces, and three-line \\N ordering', () => {
    const style: AssStyleConfig = {
      ...DEFAULT_STYLE_CONFIG,
      lineOrder: ['target', 'base', 'phonetic'],
      baseColor: '#FFFFFF',
      targetColor: '#FACC15', // R=FA, G=CC, B=15 -> &H0015CCFA
      phoneticColor: '#22D3EE', // R=22, G=D3, B=EE -> &H00EED322
      opaqueBox: true,
      boxOpacity: 55,
    };

    const ass = generateAssContent(SAMPLE_CUES, style, 'Le Chat Noir\nDirector Cut');
    assert.ok(ass.includes('Title: Le Chat Noir Director Cut'));
    assert.ok(ass.includes('ScriptType: v4.00+'));
    assert.ok(ass.includes('Style: TargetLang,Plus Jakarta Sans,48,&H0015CCFA,'));
    assert.ok(ass.includes('Style: Phonetics,Plus Jakarta Sans,38,&H00EED322,'));
    assert.ok(
      ass.includes(
        'Dialogue: 0,0:00:01.25,0:00:04.58,TargetLang,,0,0,0,,Ich verstehe nicht.\\N{\\rBaseLang}I don\'t understand.\\N{\\rPhonetics}ikh fer-SHTAY-uh nikht.',
      ),
    );
    // Curly braces in dialogue must be escaped to avoid breaking ASS override tags
    assert.ok(ass.includes('Please have a safe (trip) home.'));
  });
});
