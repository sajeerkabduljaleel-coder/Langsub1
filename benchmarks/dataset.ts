/**
 * Reproducible, original CC0 screenplay-style subtitle benchmark dataset for LangSub Phase 4A.
 *
 * Covers German, French, Japanese, and Korean across:
 * - Everyday conversation, fast dialogue, idioms/slang, questions & short responses,
 *   long split sentences, contractions/reductions, recurring names & proper nouns,
 *   emotional dialogue, and contextually ambiguous lines.
 * - Manually paired ground-truth English subtitles plus realistic misaligned/drifted/split/
 *   merged/overlapping English subtitles for alignment benchmarking.
 */

export type DialogueTag =
  | 'everyday'
  | 'fast'
  | 'idiom-slang'
  | 'question-short'
  | 'long-split'
  | 'contraction'
  | 'proper-noun'
  | 'emotional'
  | 'contextual-ambiguity';

export interface BenchmarkCueExpectation {
  index: number;
  tags: DialogueTag[];
  recurringTerms?: string[];
  notes: string;
}

export interface LanguageBenchmarkSample {
  id: string;
  language: 'German' | 'French' | 'Japanese' | 'Korean';
  title: string;
  targetSrt: string;
  /** Manually paired 1:1 ground-truth English subtitle (clean timings matching targetSrt). */
  pairedBaseSrt: string;
  cueExpectations: BenchmarkCueExpectation[];
}

export interface AlignmentGroundTruth {
  targetIndex: number;
  expectedBaseIndices: number[];
  scenarioTag:
    | 'exact'
    | 'offset'
    | 'drift'
    | 'one-to-many'
    | 'many-to-one'
    | 'overlap'
    | 'short-response'
    | 'missing-base'
    | 'missing-target';
  description: string;
}

export interface AlignmentBenchmarkCase {
  id: string;
  language: string;
  name: string;
  description: string;
  targetSrt: string;
  baseSrt: string;
  expectedTargetPairs: AlignmentGroundTruth[];
  expectedUnmatchedBaseIndices: number[];
}

export const LANGUAGE_BENCHMARK_SAMPLES: LanguageBenchmarkSample[] = [
  {
    id: 'de-station',
    language: 'German',
    title: 'Bahnhof Zoo — Platform 7 (German)',
    targetSrt: `1
00:00:01,000 --> 00:00:03,400
Lukas, hast du das Schloss schon gesehen?

2
00:00:03,500 --> 00:00:05,300
Welches? Die Tür oder das Gebäude?

3
00:00:05,400 --> 00:00:07,200
Das an der Hintertür, Mann! Ich hab's dir doch gesagt.

4
00:00:07,300 --> 00:00:07,950
Echt jetzt?

5
00:00:08,000 --> 00:00:08,650
Ja, genau!

6
00:00:08,800 --> 00:00:11,600
Lukas, mir geht's langsam auf den Keks, dass du nie zuhörst.

7
00:00:11,800 --> 00:00:14,500
Wenn wir den Nachtzug nach München um neun Uhr

8
00:00:14,550 --> 00:00:17,400
verpassen, stehen wir die ganze Nacht im Regen.

9
00:00:17,600 --> 00:00:20,400
Verzeihung, Frau Schneider, wissen Sie, ob Gleis sieben noch offen ist?

10
00:00:20,600 --> 00:00:23,500
Es tut mir so leid, ich wollte dich wirklich nicht enttäuschen!

11
00:00:23,700 --> 00:00:26,200
Schwamm drüber, Lukas. Nimm die Tasche und lauf!

12
00:00:26,400 --> 00:00:28,900
München wartet nicht auf uns — los geht's!`,
    pairedBaseSrt: `1
00:00:01,000 --> 00:00:03,400
Lukas, have you seen the lock yet?

2
00:00:03,500 --> 00:00:05,300
Which one? The door or the castle?

3
00:00:05,400 --> 00:00:07,200
The one on the back door, man! I told you already.

4
00:00:07,300 --> 00:00:07,950
Seriously?

5
00:00:08,000 --> 00:00:08,650
Yes, exactly!

6
00:00:08,800 --> 00:00:11,600
Lukas, it's really getting on my nerves that you never listen.

7
00:00:11,800 --> 00:00:14,500
If we miss the night train to Munich at nine o'clock,

8
00:00:14,550 --> 00:00:17,400
we'll be standing in the rain all night.

9
00:00:17,600 --> 00:00:20,400
Excuse me, Ms. Schneider, do you know if platform seven is still open?

10
00:00:20,600 --> 00:00:23,500
I'm so sorry, I really didn't mean to let you down!

11
00:00:23,700 --> 00:00:26,200
Water under the bridge, Lukas. Grab the bag and run!

12
00:00:26,400 --> 00:00:28,900
Munich isn't waiting for us — let's go!`,
    cueExpectations: [
      {
        index: 1,
        tags: ['contextual-ambiguity', 'proper-noun', 'question-short'],
        recurringTerms: ['Lukas'],
        notes: '"Schloss" means lock (disambiguated by cue 2–3, not castle).',
      },
      {
        index: 2,
        tags: ['contextual-ambiguity', 'question-short'],
        notes: 'Plays directly on the lock vs. castle ambiguity of "Schloss".',
      },
      {
        index: 3,
        tags: ['contraction', 'fast', 'everyday'],
        notes: 'Colloquial contraction "hab\'s" + modal particle "doch".',
      },
      {
        index: 4,
        tags: ['fast', 'question-short', 'idiom-slang'],
        notes: 'Rapid 650ms short response "Echt jetzt?".',
      },
      {
        index: 5,
        tags: ['fast', 'question-short'],
        notes: 'Rapid 650ms confirmation "Ja, genau!".',
      },
      {
        index: 6,
        tags: ['idiom-slang', 'contraction', 'proper-noun'],
        recurringTerms: ['Lukas'],
        notes: 'Idiom "auf den Keks gehen" (get on someone\'s nerves) + "geht\'s".',
      },
      {
        index: 7,
        tags: ['long-split', 'proper-noun'],
        recurringTerms: ['München'],
        notes: 'First half of split conditional sentence; verb "verpassen" is in cue 8.',
      },
      {
        index: 8,
        tags: ['long-split'],
        notes: 'Second half of split conditional sentence completing cue 7.',
      },
      {
        index: 9,
        tags: ['everyday', 'proper-noun', 'question-short'],
        notes: 'Formal "Sie" register + proper noun "Frau Schneider" + vowel-cluster "Gleis".',
      },
      {
        index: 10,
        tags: ['emotional'],
        notes: 'Emotional apology with "enttäuschen" (äu -> oy, sch -> sh).',
      },
      {
        index: 11,
        tags: ['idiom-slang', 'proper-noun'],
        recurringTerms: ['Lukas'],
        notes: 'Idiom "Schwamm drüber" (water under the bridge / forget it).',
      },
      {
        index: 12,
        tags: ['proper-noun', 'contraction', 'fast'],
        recurringTerms: ['München'],
        notes: 'Recurring proper noun "München" + contraction "geht\'s".',
      },
    ],
  },
  {
    id: 'fr-bistro',
    language: 'French',
    title: 'Le Bistro de Lyon — Last Table (French)',
    targetSrt: `1
00:00:01,000 --> 00:00:03,400
Camille, tu peux vérifier l'avocat avant midi ?

2
00:00:03,500 --> 00:00:05,200
Dans la cuisine ou au cabinet ?

3
00:00:05,300 --> 00:00:07,200
Au cabinet, voyons ! J'sais pas où t'as la tête.

4
00:00:07,300 --> 00:00:07,950
Sérieux ?

5
00:00:08,000 --> 00:00:08,700
Bah oui !

6
00:00:08,850 --> 00:00:11,500
Franchement, j'en ai ras-le-bol de courir partout à Lyon.

7
00:00:11,700 --> 00:00:14,400
Si jamais Monsieur Moreau ne signe pas ce contrat

8
00:00:14,450 --> 00:00:17,200
avant ce soir, tout notre travail tombe à l'eau.

9
00:00:17,400 --> 00:00:20,100
Excusez-moi, Madame Laurent, pourriez-vous nous accorder cinq minutes ?

10
00:00:20,300 --> 00:00:23,200
Je t'en supplie, Camille, ne me laisse pas tomber maintenant !

11
00:00:23,400 --> 00:00:25,900
T'inquiète pas, on va s'en sortir — promis.

12
00:00:26,100 --> 00:00:28,700
Monsieur Moreau arrive à Lyon dans dix minutes.`,
    pairedBaseSrt: `1
00:00:01,000 --> 00:00:03,400
Camille, can you check on the lawyer before noon?

2
00:00:03,500 --> 00:00:05,200
In the kitchen or at the firm?

3
00:00:05,300 --> 00:00:07,200
At the firm, obviously! I don't know where your head is at.

4
00:00:07,300 --> 00:00:07,950
Seriously?

5
00:00:08,000 --> 00:00:08,700
Well, yeah!

6
00:00:08,850 --> 00:00:11,500
Honestly, I'm completely fed up with running all over Lyon.

7
00:00:11,700 --> 00:00:14,400
If Mr. Moreau doesn't sign this contract

8
00:00:14,450 --> 00:00:17,200
before tonight, all our work goes down the drain.

9
00:00:17,400 --> 00:00:20,100
Excuse me, Ms. Laurent, could you spare us five minutes?

10
00:00:20,300 --> 00:00:23,200
I'm begging you, Camille, don't let me down now!

11
00:00:23,400 --> 00:00:25,900
Don't worry, we'll pull through — I promise.

12
00:00:26,100 --> 00:00:28,700
Mr. Moreau arrives in Lyon in ten minutes.`,
    cueExpectations: [
      {
        index: 1,
        tags: ['contextual-ambiguity', 'proper-noun', 'question-short'],
        recurringTerms: ['Camille'],
        notes: '"avocat" = lawyer (not avocado), resolved by cues 2–3.',
      },
      {
        index: 2,
        tags: ['contextual-ambiguity', 'question-short'],
        notes: 'Plays on avocado (kitchen) vs lawyer (law office).',
      },
      {
        index: 3,
        tags: ['contraction', 'idiom-slang', 'fast'],
        notes: 'Spoken contractions "J\'sais pas", "t\'as" + idiom "où t\'as la tête".',
      },
      {
        index: 4,
        tags: ['fast', 'question-short'],
        notes: 'Short response "Sérieux ?".',
      },
      {
        index: 5,
        tags: ['fast', 'question-short', 'idiom-slang'],
        notes: 'Colloquial short response "Bah oui !".',
      },
      {
        index: 6,
        tags: ['idiom-slang', 'proper-noun'],
        recurringTerms: ['Lyon'],
        notes: 'Idiom "en avoir ras-le-bol" (be fed up) + nasal vowels + "Lyon".',
      },
      {
        index: 7,
        tags: ['long-split', 'proper-noun'],
        recurringTerms: ['Monsieur Moreau'],
        notes: 'Split sentence part 1 + recurring name "Monsieur Moreau".',
      },
      {
        index: 8,
        tags: ['long-split', 'idiom-slang'],
        notes: 'Split sentence part 2 + idiom "tomber à l\'eau" (fall through).',
      },
      {
        index: 9,
        tags: ['everyday', 'proper-noun', 'question-short'],
        notes: 'Formal "vous" + liaison ("Excusez-moi", "cinq minutes") + "Madame Laurent".',
      },
      {
        index: 10,
        tags: ['emotional', 'proper-noun'],
        recurringTerms: ['Camille'],
        notes: 'Emotional plea + recurring name "Camille".',
      },
      {
        index: 11,
        tags: ['contraction', 'idiom-slang', 'everyday'],
        notes: 'Dropped "ne" ("T\'inquiète pas") + idiom "s\'en sortir".',
      },
      {
        index: 12,
        tags: ['proper-noun', 'everyday'],
        recurringTerms: ['Monsieur Moreau', 'Lyon'],
        notes: 'Recurring proper nouns "Monsieur Moreau" and "Lyon".',
      },
    ],
  },
  {
    id: 'ja-rain',
    language: 'Japanese',
    title: 'Shinjuku Rain — Final Delivery (Japanese)',
    targetSrt: `1
00:00:01,000 --> 00:00:03,400
健太、さっきの橋はもう渡った？

2
00:00:03,500 --> 00:00:05,200
川の橋？それとも端っこのこと？

3
00:00:05,300 --> 00:00:07,200
新宿の古い橋だよ！もう忘れちゃったの？

4
00:00:07,300 --> 00:00:07,950
マジで？

5
00:00:08,000 --> 00:00:08,650
うん、そうだよ。

6
00:00:08,800 --> 00:00:11,600
健太、そんな言い方されたら腹が立つじゃん。

7
00:00:11,800 --> 00:00:14,500
もし今日の夕方までにこの荷物を

8
00:00:14,550 --> 00:00:17,400
届けられなかったら、信用を失うんだ。

9
00:00:17,600 --> 00:00:20,400
恐れ入りますが、高橋様はいらっしゃいますでしょうか。

10
00:00:20,600 --> 00:00:23,500
ごめん、本当にわざとじゃなかったんだ！

11
00:00:23,700 --> 00:00:26,300
まあ、済んだことは水に流そう、健太。

12
00:00:26,500 --> 00:00:29,000
新宿の雨が強くなる前に急ごう。`,
    pairedBaseSrt: `1
00:00:01,000 --> 00:00:03,400
Kenta, did you already cross that bridge from earlier?

2
00:00:03,500 --> 00:00:05,200
The river bridge? Or do you mean the edge?

3
00:00:05,300 --> 00:00:07,200
The old bridge in Shinjuku! Did you forget already?

4
00:00:07,300 --> 00:00:07,950
For real?

5
00:00:08,000 --> 00:00:08,650
Yeah, that's right.

6
00:00:08,800 --> 00:00:11,600
Kenta, talking to me like that really ticks me off.

7
00:00:11,800 --> 00:00:14,500
If we can't deliver this package

8
00:00:14,550 --> 00:00:17,400
by this evening, we'll lose their trust.

9
00:00:17,600 --> 00:00:20,400
Excuse me, would Mr. Takahashi happen to be available?

10
00:00:20,600 --> 00:00:23,500
I'm sorry, I really didn't do it on purpose!

11
00:00:23,700 --> 00:00:26,300
Well, let's let bygones be bygones, Kenta.

12
00:00:26,500 --> 00:00:29,000
Let's hurry before the rain in Shinjuku gets heavier.`,
    cueExpectations: [
      {
        index: 1,
        tags: ['contextual-ambiguity', 'proper-noun', 'question-short'],
        recurringTerms: ['健太'],
        notes: 'Kanji 橋 (hashi = bridge) + particle は (wa) + recurring name 健太 (Kenta).',
      },
      {
        index: 2,
        tags: ['contextual-ambiguity', 'question-short'],
        notes: 'Wordplay on 橋 (bridge) vs 端っこ (edge).',
      },
      {
        index: 3,
        tags: ['contraction', 'proper-noun', 'fast'],
        recurringTerms: ['新宿'],
        notes: 'Spoken contraction 忘れちゃった (from 忘れてしまった) + place 新宿 (Shinjuku).',
      },
      {
        index: 4,
        tags: ['idiom-slang', 'fast', 'question-short'],
        notes: 'Slang short question マジで？ (For real?).',
      },
      {
        index: 5,
        tags: ['fast', 'question-short'],
        notes: 'Short response うん、そうだよ。',
      },
      {
        index: 6,
        tags: ['idiom-slang', 'contraction', 'proper-noun'],
        recurringTerms: ['健太'],
        notes: 'Idiom 腹が立つ (get angry) + casual contraction じゃん.',
      },
      {
        index: 7,
        tags: ['long-split'],
        notes: 'Split conditional clause part 1 (今日 = kyou, 夕方 = yuugata, 荷物 = nimotsu, を = o).',
      },
      {
        index: 8,
        tags: ['long-split'],
        notes: 'Split conditional clause part 2 (届けられなかったら, 信用 = shinyou).',
      },
      {
        index: 9,
        tags: ['everyday', 'proper-noun', 'question-short'],
        notes: 'Formal keigo 恐れ入りますが + 高橋様 (Takahashi-sama) + いらっしゃいますでしょうか.',
      },
      {
        index: 10,
        tags: ['emotional', 'contraction'],
        notes: 'Emotional apology + spoken じゃなかったんだ.',
      },
      {
        index: 11,
        tags: ['idiom-slang', 'proper-noun'],
        recurringTerms: ['健太'],
        notes: 'Idiom 水に流す (let bygones be bygones / forgive and forget).',
      },
      {
        index: 12,
        tags: ['proper-noun', 'everyday'],
        recurringTerms: ['新宿'],
        notes: 'Recurring proper noun 新宿 (Shinjuku) + 雨 (ame).',
      },
    ],
  },
  {
    id: 'ko-seoul',
    language: 'Korean',
    title: 'Busan Ferry — Midnight Pier (Korean)',
    targetSrt: `1
00:00:01,000 --> 00:00:03,400
민준아, 배는 벌써 왔어?

2
00:00:03,500 --> 00:00:05,200
바다의 배 말이야, 먹는 배 말이야?

3
00:00:05,300 --> 00:00:07,200
부산 가는 여객선 말이야! 뭐해, 빨리 나와!

4
00:00:07,300 --> 00:00:07,950
진짜로?

5
00:00:08,000 --> 00:00:08,650
응, 당연하지!

6
00:00:08,800 --> 00:00:11,600
민준아, 넌 진짜 눈치가 없어도 너무 없다.

7
00:00:11,800 --> 00:00:14,500
만약 오늘 밤 마지막 배를

8
00:00:14,550 --> 00:00:17,400
놓치면 내일 아침까지 여기서 기다려야 해.

9
00:00:17,600 --> 00:00:20,400
실례합니다, 김 부장님, 서류 확인해 주실 수 있으십니까?

10
00:00:20,600 --> 00:00:23,500
미안해, 정말 일부러 그런 게 아니야!

11
00:00:23,700 --> 00:00:26,300
발 없는 말이 천 리 간다니까 조심해, 민준아.

12
00:00:26,500 --> 00:00:29,000
감사합니다, 부산행 표 두 장 주세요.`,
    pairedBaseSrt: `1
00:00:01,000 --> 00:00:03,400
Minjun, has the boat arrived yet?

2
00:00:03,500 --> 00:00:05,200
Do you mean the boat on the sea, or a pear to eat?

3
00:00:05,300 --> 00:00:07,200
The ferry to Busan! What are you doing, hurry up and come out!

4
00:00:07,300 --> 00:00:07,950
Really?

5
00:00:08,000 --> 00:00:08,650
Yeah, obviously!

6
00:00:08,800 --> 00:00:11,600
Minjun, you seriously have zero situational awareness.

7
00:00:11,800 --> 00:00:14,500
If we miss the last boat tonight,

8
00:00:14,550 --> 00:00:17,400
we'll have to wait here until tomorrow morning.

9
00:00:17,600 --> 00:00:20,400
Excuse me, Director Kim, could you please review these documents?

10
00:00:20,600 --> 00:00:23,500
I'm sorry, I really didn't do it on purpose!

11
00:00:23,700 --> 00:00:26,300
Word travels fast, so be careful, Minjun.

12
00:00:26,500 --> 00:00:29,000
Thank you, please give me two tickets to Busan.`,
    cueExpectations: [
      {
        index: 1,
        tags: ['contextual-ambiguity', 'proper-noun', 'question-short'],
        recurringTerms: ['민준'],
        notes: 'Homonym 배 (boat / pear / stomach), disambiguated by cues 2–3. Batchim liaison: 왔어 -> wah-ssuh.',
      },
      {
        index: 2,
        tags: ['contextual-ambiguity', 'question-short'],
        notes: 'Explicitly contrasts boat vs pear; nasalization 먹는 -> mung-neun (NOT meok-neun!).',
      },
      {
        index: 3,
        tags: ['contraction', 'proper-noun', 'fast'],
        recurringTerms: ['부산'],
        notes: 'Contraction 뭐해 + 여객선 tensification (yuh-gaek-ssun) + Busan.',
      },
      {
        index: 4,
        tags: ['fast', 'question-short'],
        notes: 'Short response 진짜로?',
      },
      {
        index: 5,
        tags: ['fast', 'question-short'],
        notes: 'Short response 응, 당연하지!',
      },
      {
        index: 6,
        tags: ['idiom-slang', 'contraction', 'proper-noun'],
        recurringTerms: ['민준'],
        notes: 'Idiom 눈치가 없다 (clueless / lack tact) + contraction 넌 + 없어도 (up-ssuh-doh) + 없다 (up-ttah).',
      },
      {
        index: 7,
        tags: ['long-split'],
        notes: 'Split conditional part 1.',
      },
      {
        index: 8,
        tags: ['long-split'],
        notes: 'Split conditional part 2; 놓치면 aspiration (noh-chee-myun), 아침까지.',
      },
      {
        index: 9,
        tags: ['everyday', 'proper-noun', 'question-short'],
        notes: 'Formal register 실례합니다 (shil-lyeh-ham-nee-dah, lateralization + nasalization!) + 김 부장님 + 있으십니까 (ee-sseu-shim-nee-kkah).',
      },
      {
        index: 10,
        tags: ['emotional', 'contraction'],
        notes: 'Emotional apology + contraction 게 (것이).',
      },
      {
        index: 11,
        tags: ['idiom-slang', 'proper-noun'],
        recurringTerms: ['민준'],
        notes: 'Proverb 발 없는 말이 천 리 간다 (words without feet travel a thousand miles -> word travels fast); 없는 -> um-neun, 천 리 -> chul-lee.',
      },
      {
        index: 12,
        tags: ['everyday', 'proper-noun'],
        recurringTerms: ['부산'],
        notes: '감사합니다 (gam-sah-ham-nee-dah, ㅂ+ㄴ -> m+n assimilation!) + recurring 부산.',
      },
    ],
  },
];

/**
 * Alignment & Timing Benchmark Suite:
 * Exercises realistic alignment stressors beyond clean 1:1 pairing.
 */
export const ALIGNMENT_BENCHMARK_CASES: AlignmentBenchmarkCase[] = [
  {
    id: 'align-constant-offset-split-merge',
    language: 'German',
    name: 'Global Offset (+1.8s) + 1-to-Many + Many-to-One + Missing Cues + Short Responses',
    description:
      'Simulates two real-world subtitle releases with a +1800ms global shift, one merged English cue covering two German cues (many-to-one), two split English cues covering one German cue (one-to-many), rapid short responses, one missing English cue, and one extra English cue.',
    targetSrt: `1
00:00:05,000 --> 00:00:07,400
Lukas, hast du das Schloss schon gesehen?

2
00:00:07,500 --> 00:00:08,100
Echt jetzt?

3
00:00:08,150 --> 00:00:08,750
Ja, genau!

4
00:00:09,000 --> 00:00:13,200
Wenn wir den Nachtzug nach München um neun verpassen, stehen wir im Regen.

5
00:00:13,600 --> 00:00:15,800
Verzeihung, Frau Schneider,

6
00:00:15,900 --> 00:00:18,300
ist Gleis sieben noch offen?

7
00:00:19,000 --> 00:00:21,400
Lauf schneller, der Zug fährt gleich ab!

8
00:00:25,000 --> 00:00:27,500
Schwamm drüber, Lukas.`,
    baseSrt: `1
00:00:03,200 --> 00:00:05,600
Lukas, have you seen the lock yet?

2
00:00:05,700 --> 00:00:06,300
Seriously?

3
00:00:06,350 --> 00:00:06,950
Yes, exactly!

4
00:00:07,200 --> 00:00:09,200
If we miss the nine o'clock night train to Munich,

5
00:00:09,250 --> 00:00:11,400
we'll be standing in the rain.

6
00:00:11,800 --> 00:00:16,500
Excuse me, Ms. Schneider,
is platform seven still open?

7
00:00:20,400 --> 00:00:22,600
[Station announcement: all aboard!]

8
00:00:23,200 --> 00:00:25,700
Water under the bridge, Lukas.`,
    expectedTargetPairs: [
      { targetIndex: 1, expectedBaseIndices: [1], scenarioTag: 'offset', description: 'Clean +1800ms shifted 1:1 cue' },
      { targetIndex: 2, expectedBaseIndices: [2], scenarioTag: 'short-response', description: 'Rapid 600ms short response ("Echt jetzt?")' },
      { targetIndex: 3, expectedBaseIndices: [3], scenarioTag: 'short-response', description: 'Rapid 600ms short response ("Ja, genau!")' },
      { targetIndex: 4, expectedBaseIndices: [4, 5], scenarioTag: 'one-to-many', description: 'One long German cue spanning two English cues' },
      { targetIndex: 5, expectedBaseIndices: [6], scenarioTag: 'many-to-one', description: 'First half of two German cues covered by one multiline English cue' },
      { targetIndex: 6, expectedBaseIndices: [6], scenarioTag: 'many-to-one', description: 'Second half of two German cues covered by one multiline English cue' },
      { targetIndex: 7, expectedBaseIndices: [], scenarioTag: 'missing-base', description: 'German cue with no matching English cue (gap)' },
      { targetIndex: 8, expectedBaseIndices: [8], scenarioTag: 'offset', description: 'Clean +1800ms shifted closing cue' },
    ],
    expectedUnmatchedBaseIndices: [7],
  },
  {
    id: 'align-progressive-drift',
    language: 'Japanese',
    name: 'Progressive Timing Drift (23.976fps vs 25fps / gradual +2.8s drift)',
    description:
      'Simulates a common real-world framerate mismatch where target and base subtitles start aligned at 00:00:02 and drift progressively apart by ~4.2% (~2.8 seconds by 01:08). Tests whether global constant-offset alignment breaks under progressive drift.',
    targetSrt: `1
00:00:02,000 --> 00:00:04,500
健太、さっきの橋はもう渡った？

2
00:00:12,000 --> 00:00:14,500
新宿の古い橋だよ！

3
00:00:22,000 --> 00:00:24,500
もし今日の夕方までにこの荷物を

4
00:00:32,000 --> 00:00:34,500
届けられなかったら、信用を失うんだ。

5
00:00:42,000 --> 00:00:44,500
恐れ入りますが、高橋様はいらっしゃいますでしょうか。

6
00:00:52,000 --> 00:00:54,500
ごめん、本当にわざとじゃなかったんだ！

7
00:01:02,000 --> 00:01:04,500
まあ、済んだことは水に流そう、健太。

8
00:01:12,000 --> 00:01:14,500
新宿の雨が強くなる前に急ごう。`,
    baseSrt: `1
00:00:02,000 --> 00:00:04,500
Kenta, did you already cross that bridge from earlier?

2
00:00:11,600 --> 00:00:14,100
The old bridge in Shinjuku!

3
00:00:21,200 --> 00:00:23,700
If we can't deliver this package by this evening,

4
00:00:30,800 --> 00:00:33,300
we'll lose their trust.

5
00:00:40,400 --> 00:00:42,900
Excuse me, would Mr. Takahashi be available?

6
00:00:50,000 --> 00:00:52,500
I'm sorry, I really didn't do it on purpose!

7
00:00:59,600 --> 00:01:02,100
Well, let's let bygones be bygones, Kenta.

8
00:01:09,200 --> 00:01:11,700
Let's hurry before the rain in Shinjuku gets heavier.`,
    expectedTargetPairs: [
      { targetIndex: 1, expectedBaseIndices: [1], scenarioTag: 'drift', description: '0ms drift' },
      { targetIndex: 2, expectedBaseIndices: [2], scenarioTag: 'drift', description: '+400ms drift' },
      { targetIndex: 3, expectedBaseIndices: [3], scenarioTag: 'drift', description: '+800ms drift' },
      { targetIndex: 4, expectedBaseIndices: [4], scenarioTag: 'drift', description: '+1200ms drift' },
      { targetIndex: 5, expectedBaseIndices: [5], scenarioTag: 'drift', description: '+1600ms drift' },
      { targetIndex: 6, expectedBaseIndices: [6], scenarioTag: 'drift', description: '+2000ms drift' },
      { targetIndex: 7, expectedBaseIndices: [7], scenarioTag: 'drift', description: '+2400ms drift' },
      { targetIndex: 8, expectedBaseIndices: [8], scenarioTag: 'drift', description: '+2800ms drift' },
    ],
    expectedUnmatchedBaseIndices: [],
  },
  {
    id: 'align-overlapping-fast',
    language: 'French',
    name: 'Overlapping Speech & Rapid Back-and-Forth Dialogue',
    description:
      'Simulates overlapping dual-speaker cinema dialogue and fast <700ms interjections with slight 250–350ms release jitter between French and English tracks.',
    targetSrt: `1
00:00:01,000 --> 00:00:03,200
Camille, tu peux vérifier l'avocat avant midi ?

2
00:00:02,600 --> 00:00:04,500
Dans la cuisine ou au cabinet ?

3
00:00:04,200 --> 00:00:06,200
Au cabinet, voyons !

4
00:00:06,250 --> 00:00:06,850
Sérieux ?

5
00:00:06,900 --> 00:00:07,500
Bah oui !

6
00:00:07,600 --> 00:00:10,200
Monsieur Moreau arrive à Lyon dans dix minutes.`,
    baseSrt: `1
00:00:01,250 --> 00:00:03,400
Camille, can you check on the lawyer before noon?

2
00:00:02,850 --> 00:00:04,700
In the kitchen or at the firm?

3
00:00:04,450 --> 00:00:06,350
At the firm, obviously!

4
00:00:06,400 --> 00:00:07,000
Seriously?

5
00:00:07,100 --> 00:00:07,700
Well, yeah!

6
00:00:07,850 --> 00:00:10,450
Mr. Moreau arrives in Lyon in ten minutes.`,
    expectedTargetPairs: [
      { targetIndex: 1, expectedBaseIndices: [1], scenarioTag: 'overlap', description: 'Overlaps with cue 2 by 600ms' },
      { targetIndex: 2, expectedBaseIndices: [2], scenarioTag: 'overlap', description: 'Overlaps with cue 1 and cue 3' },
      { targetIndex: 3, expectedBaseIndices: [3], scenarioTag: 'overlap', description: 'Starts 300ms before cue 2 finishes' },
      { targetIndex: 4, expectedBaseIndices: [4], scenarioTag: 'short-response', description: 'Rapid 600ms interjection with +150ms jitter' },
      { targetIndex: 5, expectedBaseIndices: [5], scenarioTag: 'short-response', description: 'Rapid 600ms interjection with +200ms jitter' },
      { targetIndex: 6, expectedBaseIndices: [6], scenarioTag: 'exact', description: 'Standard closing cue with +250ms jitter' },
    ],
    expectedUnmatchedBaseIndices: [],
  },
  {
    id: 'align-korean-unsplit-many-to-one',
    language: 'Korean',
    name: 'Many-to-One Without Punctuation Break + Short Interjection Collision',
    description:
      'Tests two Korean split clauses covered by a single English sentence with a comma/conjunction, followed by a rapid short reply right after a longer cue.',
    targetSrt: `1
00:00:01,000 --> 00:00:03,100
만약 오늘 밤 마지막 배를

2
00:00:03,150 --> 00:00:05,400
놓치면 내일 아침까지 여기서 기다려야 해.

3
00:00:05,500 --> 00:00:06,100
진짜로?

4
00:00:06,150 --> 00:00:06,800
응, 당연하지!

5
00:00:07,200 --> 00:00:09,800
감사합니다, 부산행 표 두 장 주세요.`,
    baseSrt: `1
00:00:01,000 --> 00:00:05,400
If we miss the last boat tonight, we'll have to wait here until tomorrow morning.

2
00:00:05,550 --> 00:00:06,150
Really?

3
00:00:06,200 --> 00:00:06,850
Yeah, obviously!

4
00:00:07,250 --> 00:00:09,850
Thank you, please give me two tickets to Busan.`,
    expectedTargetPairs: [
      { targetIndex: 1, expectedBaseIndices: [1], scenarioTag: 'many-to-one', description: 'Korean split conditional clause 1 paired with comma-separated English cue' },
      { targetIndex: 2, expectedBaseIndices: [1], scenarioTag: 'many-to-one', description: 'Korean split conditional clause 2 paired with comma-separated English cue' },
      { targetIndex: 3, expectedBaseIndices: [2], scenarioTag: 'short-response', description: 'Rapid 600ms "진짜로?"' },
      { targetIndex: 4, expectedBaseIndices: [3], scenarioTag: 'short-response', description: 'Rapid 650ms "응, 당연하지!"' },
      { targetIndex: 5, expectedBaseIndices: [4], scenarioTag: 'exact', description: 'Clean closing cue' },
    ],
    expectedUnmatchedBaseIndices: [],
  },
];
