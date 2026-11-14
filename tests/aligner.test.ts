import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alignDualSubtitles } from '../server/subtitles/aligner.ts';
import type { RawCue } from '../src/types/subtitle.ts';

function cue(index: number, startMs: number, endMs: number, text: string, originalText = text): RawCue {
  return { index, startMs, endMs, text, originalText };
}

describe('Dual-Subtitle Aligner', () => {
  it('detects and compensates for global timing offsets (+400ms and +12,500ms recap shift)', () => {
    // Japanese target cues shifted +12,500ms relative to English base cues
    const offset = 12500;
    const base: RawCue[] = [
      cue(1, 1000, 4000, 'We are almost at the final stop.'),
      cue(2, 4500, 8000, 'Yes, we will arrive in ten minutes.'),
      cue(3, 8500, 12000, 'It has gotten quite cold outside.'),
      cue(4, 12500, 16000, 'I am glad I brought an umbrella.'),
    ];
    const target: RawCue[] = [
      cue(1, 1000 + offset, 4000 + offset, 'もうすぐ終点ですね。'),
      cue(2, 4500 + offset, 8000 + offset, 'ええ、あと十分で着きますよ。'),
      cue(3, 8500 + offset, 12000 + offset, '外は冷えてきましたね。'),
      cue(4, 12500 + offset, 16000 + offset, '傘を持ってきてよかったです。'),
    ];

    const res = alignDualSubtitles(target, base);
    assert.ok(Math.abs(res.stats.estimatedOffsetMs - offset) <= 250);
    assert.equal(res.aligned.length, 4);
    assert.equal(res.stats.exactMatches, 4);
    assert.equal(res.stats.unmatchedTarget, 0);
    assert.equal(res.stats.unmatchedBase, 0);
    assert.equal(res.aligned[0].baseText, 'We are almost at the final stop.');
    assert.equal(res.aligned[3].targetText, '傘を持ってきてよかったです。');
  });

  it('merges one-to-many split base cues even when first cue exceeds 48 characters', () => {
    const target: RawCue[] = [
      cue(1, 1000, 6200, 'Ich warte schon seit einer halben Stunde auf den letzten Zug nach Berlin.'),
    ];
    const base: RawCue[] = [
      cue(1, 1000, 3500, 'I have already been waiting at this empty station platform'),
      cue(2, 3600, 6200, 'for half an hour for the very last train to Berlin.'),
    ];

    const res = alignDualSubtitles(target, base);
    assert.equal(res.aligned.length, 1);
    assert.equal(res.aligned[0].relationship, 'one-to-many');
    assert.equal(res.stats.oneToManyMatches, 1);
    assert.equal(
      res.aligned[0].baseText,
      'I have already been waiting at this empty station platform for half an hour for the very last train to Berlin.',
    );
    assert.ok(res.aligned[0].confidence >= 0.7);
  });

  it('handles many-to-one cues by splitting multi-sentence/multiline base cue across target cues', () => {
    const target: RawCue[] = [
      cue(1, 1000, 3200, 'Bonjour, mon ami.'),
      cue(2, 3300, 5600, 'Comment vas-tu aujourd’hui ?'),
    ];
    const base: RawCue[] = [
      cue(
        1,
        1000,
        5600,
        'Hello, my friend. How are you today?',
        'Hello, my friend.\nHow are you today?',
      ),
    ];

    const res = alignDualSubtitles(target, base);
    assert.equal(res.aligned.length, 2);
    assert.equal(res.aligned[0].relationship, 'many-to-one');
    assert.equal(res.aligned[1].relationship, 'many-to-one');
    assert.equal(res.aligned[0].baseText, 'Hello, my friend.');
    assert.equal(res.aligned[1].baseText, 'How are you today?');
    assert.equal(res.stats.manyToOneMatches, 2);
  });

  it('preserves unmatched target and unmatched base cues without silently discarding dialogue', () => {
    const target: RawCue[] = [
      cue(1, 1000, 3500, '¿Dónde está la estación?'),
      cue(2, 10000, 13000, 'No hay nadie en el andén.'),
    ];
    const base: RawCue[] = [
      cue(1, 1000, 3500, 'Where is the station?'),
      cue(2, 5000, 8000, 'Wait a moment, I dropped my ticket!'),
    ];

    const res = alignDualSubtitles(target, base);
    assert.equal(res.stats.exactMatches, 1);
    assert.equal(res.stats.unmatchedTarget, 1);
    assert.equal(res.stats.unmatchedBase, 1);
    assert.equal(res.unmatchedBaseCues.length, 1);
    assert.equal(res.unmatchedBaseCues[0].text, 'Wait a moment, I dropped my ticket!');

    // Chronological aligned list preserves all 3 cues: matched pair (1000ms), unmatched base (5000ms), unmatched target (10000ms)
    assert.equal(res.aligned.length, 3);
    assert.equal(res.aligned[0].relationship, 'exact');
    assert.equal(res.aligned[1].relationship, 'unmatched-base');
    assert.equal(res.aligned[1].baseText, 'Wait a moment, I dropped my ticket!');
    assert.equal(res.aligned[1].targetText, '');
    assert.equal(res.aligned[2].relationship, 'unmatched-target');
    assert.equal(res.aligned[2].targetText, 'No hay nadie en el andén.');
    assert.equal(res.aligned[2].baseText, '');
  });

  it('aligns cues with differing punctuation, line breaks, and slight timing drift', () => {
    const target: RawCue[] = [
      cue(1, 2000, 5000, '— Entschuldigung...\nist dieser Platz frei?'),
      cue(2, 5500, 8400, 'Ja, natürlich! Setzen Sie sich.'),
    ];
    const base: RawCue[] = [
      cue(1, 2250, 5150, 'Excuse me, is this seat free?'),
      cue(2, 5600, 8500, 'Yes, of course. Have a seat!'),
    ];

    const res = alignDualSubtitles(target, base);
    assert.equal(res.aligned.length, 2);
    assert.equal(res.stats.exactMatches, 2);
    assert.ok(res.aligned[0].confidence >= 0.75);
    assert.ok(res.aligned[1].confidence >= 0.75);
  });
});
