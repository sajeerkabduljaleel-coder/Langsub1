import type { ConversionMode } from '../types/subtitle';

export interface SampleDataset {
  id: string;
  title: string;
  mode: ConversionMode;
  baseLang: string;
  targetLang: string;
  primaryFileName: string;
  primaryContent: string;
  secondaryFileName?: string;
  secondaryContent?: string;
  description: string;
}

export const SAMPLE_DATASETS: SampleDataset[] = [
  {
    id: 'german-cafe',
    title: 'German Cinema — Evening at Le Chat Noir',
    mode: 'target-first',
    baseLang: 'English',
    targetLang: 'German',
    primaryFileName: 'le_chat_noir_de.srt',
    description:
      'Target-first German SRT containing SDH annotations and multi-line dialogue to test cleaning and three-line conversion.',
    primaryContent: `1
00:00:02,100 --> 00:00:05,200
[Regen prasselt leise auf das Pflaster]

2
00:00:05,500 --> 00:00:08,900
Entschuldigung, ist dieser Platz
noch frei?

3
00:00:09,300 --> 00:00:12,400
Ich verstehe nicht.

4
00:00:12,800 --> 00:00:16,500
Könnten Sie bitte etwas
langsamer sprechen?

5
00:00:17,000 --> 00:00:20,800
KELLNER: Zwei Espresso und ein Glas Wasser,
kommt sofort.

6
00:00:21,400 --> 00:00:25,100
Ich warte schon seit einer halben Stunde
auf den letzten Zug.

7
00:00:25,600 --> 00:00:29,200
(seufzt tief)
Manchmal verliert man hier jedes Zeitgefühl.

8
00:00:29,800 --> 00:00:33,500
Wollen wir zusammen ein Stück gehen,
bevor der Regen stärker wird?
`,
  },
  {
    id: 'japanese-train-dual',
    title: 'Japanese Commuter Train — Dual-File Merge',
    mode: 'dual-merge',
    baseLang: 'English',
    targetLang: 'Japanese',
    primaryFileName: 'midnight_express_ja.srt',
    secondaryFileName: 'midnight_express_en.srt',
    description:
      'Dual-file Japanese and English SRT tracks with a 400ms offset to demonstrate intelligent alignment and phonetic generation.',
    primaryContent: `1
00:00:01,500 --> 00:00:04,600
もうすぐ終点ですね。

2
00:00:05,100 --> 00:00:08,500
ええ、あと十分くらいで着きますよ。

3
00:00:09,000 --> 00:00:12,800
外は随分と冷えてきましたね。

4
00:00:13,200 --> 00:00:17,400
傘を持ってきてよかったと
本当に思います。

5
00:00:18,000 --> 00:00:21,600
明日の朝、またここで会いましょう。

6
00:00:22,100 --> 00:00:25,500
お気をつけてお帰りください。
`,
    secondaryContent: `1
00:00:01,100 --> 00:00:04,200
We are almost at the final stop, aren't we?

2
00:00:04,700 --> 00:00:08,100
Yes, we will arrive in about ten minutes.

3
00:00:08,600 --> 00:00:12,400
It has gotten quite cold outside.

4
00:00:12,800 --> 00:00:17,000
I am really glad I brought an umbrella.

5
00:00:17,600 --> 00:00:21,200
Let's meet here again tomorrow morning.

6
00:00:21,700 --> 00:00:25,100
Please have a safe trip home.
`,
  },
  {
    id: 'spanish-base-first',
    title: 'Spanish Street Mystery — Base-First VTT',
    mode: 'base-first',
    baseLang: 'English',
    targetLang: 'Spanish',
    primaryFileName: 'street_mystery_en.vtt',
    description:
      'WebVTT English track demonstrating Base-First translation into natural Spanish dialogue plus English phonetics.',
    primaryContent: `WEBVTT

00:00:02.000 --> 00:00:05.300 align:start
Did you hear what she whispered at the station?

00:00:05.800 --> 00:00:09.200
I couldn't catch a single word over the crowd.

00:00:09.800 --> 00:00:13.400
She left this key on the table before leaving.

00:00:14.000 --> 00:00:17.800
We shouldn't stay here any longer than necessary.

00:00:18.200 --> 00:00:22.000
Wait for me around the corner in five minutes.
`,
  },
];
