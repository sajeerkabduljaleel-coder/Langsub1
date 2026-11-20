import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DEFAULT_LEARNING_CONTROLS,
  type AssStyleConfig,
  type LearningControlsConfig,
  type SubtitleLineRole,
  type TriLineCue,
} from '../types/subtitle';
import {
  computeEffectiveCueDurationMs,
  getActiveWordIndex,
  resolveCueTickCompletion,
  tokenizeCueWords,
} from '../utils/learningControls';
import cafeStill from '/src/assets/images/cinema_cafe_still_1794633452935.jpg';
import trainStill from '/src/assets/images/cinema_train_still_1794633453954.jpg';

interface CinemaPreviewProps {
  cues: TriLineCue[];
  styleConfig: AssStyleConfig;
  activeCueIndex: number;
  onSelectCueIndex: (idx: number) => void;
  title?: string;
  learningControls?: LearningControlsConfig;
  onChangeLearningControls?: (next: LearningControlsConfig) => void;
}

type BackdropMode = 'cafe' | 'train' | 'matte';

function formatDisplayTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  const milli = clamped % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export function CinemaPreview({
  cues,
  styleConfig,
  activeCueIndex,
  onSelectCueIndex,
  title,
  learningControls,
  onChangeLearningControls,
}: CinemaPreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [backdrop, setBackdrop] = useState<BackdropMode>('cafe');
  const [imgFailed, setImgFailed] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [internalLearning, setInternalLearning] = useState<LearningControlsConfig>(
    DEFAULT_LEARNING_CONTROLS,
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pauseRemainingMs, setPauseRemainingMs] = useState(0);
  const [manualWord, setManualWord] = useState<{
    role: SubtitleLineRole;
    index: number;
  } | null>(null);

  const learning = learningControls ?? internalLearning;
  const updateLearning = (patch: Partial<LearningControlsConfig>) => {
    const next = { ...learning, ...patch };
    if (onChangeLearningControls) {
      onChangeLearningControls(next);
    } else {
      setInternalLearning(next);
    }
  };

  const safeIndex = Math.max(0, Math.min(activeCueIndex, Math.max(0, cues.length - 1)));
  const activeCue = cues[safeIndex] || null;
  const effectiveDurationMs = computeEffectiveCueDurationMs(
    activeCue,
    learning.playbackSpeed,
  );

  // Stop playback cleanly if cues are cleared
  useEffect(() => {
    if (cues.length === 0) {
      setIsPlaying(false);
      setElapsedMs(0);
      setPauseRemainingMs(0);
      setManualWord(null);
    }
  }, [cues.length]);

  // Reset elapsed progress when switching cues manually
  useEffect(() => {
    setElapsedMs(0);
    setManualWord(null);
  }, [safeIndex]);

  // Ref holds mutable playback tick state to avoid restarting interval on every 100ms tick
  const tickStateRef = useRef({
    safeIndex,
    elapsedMs,
    pauseRemainingMs,
  });
  tickStateRef.current = { safeIndex, elapsedMs, pauseRemainingMs };

  useEffect(() => {
    if (!isPlaying || cues.length === 0) return;

    const timer = window.setInterval(() => {
      const state = tickStateRef.current;
      const currentCue = cues[state.safeIndex];
      const cueDur = computeEffectiveCueDurationMs(currentCue, learning.playbackSpeed);

      if (state.pauseRemainingMs > 0) {
        const nextPause = Math.max(0, state.pauseRemainingMs - 100);
        setPauseRemainingMs(nextPause);
        return;
      }

      const nextElapsed = state.elapsedMs + 100;
      if (nextElapsed < cueDur) {
        setElapsedMs(nextElapsed);
        return;
      }

      const transition = resolveCueTickCompletion({
        currentIndex: state.safeIndex,
        totalCues: cues.length,
        repeatCurrentCue: learning.repeatCurrentCue,
        pauseBetweenCuesMs: learning.pauseBetweenCuesMs,
      });

      setElapsedMs(transition.nextElapsedMs);
      setPauseRemainingMs(transition.nextPauseRemainingMs);
      if (transition.nextCueIndex !== state.safeIndex) {
        onSelectCueIndex(transition.nextCueIndex);
      }
      if (transition.nextPhase === 'stopped') {
        setIsPlaying(false);
      }
    }, 100);

    return () => window.clearInterval(timer);
  }, [
    isPlaying,
    cues,
    learning.playbackSpeed,
    learning.repeatCurrentCue,
    learning.pauseBetweenCuesMs,
    onSelectCueIndex,
  ]);

  const backdropSrc = useMemo(() => {
    if (backdrop === 'cafe') return cafeStill;
    if (backdrop === 'train') return trainStill;
    return null;
  }, [backdrop]);

  const getLineProps = (role: SubtitleLineRole) => {
    if (!activeCue) return null;
    if (role === 'base') {
      if (!learning.showBase) return null;
      return {
        text: activeCue.baseText,
        color: styleConfig.baseColor,
        sizePx: Math.max(12, Math.round(styleConfig.baseFontSize * 0.42)),
        weight: 500,
        label: 'Base',
      };
    }
    if (role === 'target') {
      if (!learning.showTarget) return null;
      return {
        text: activeCue.targetText,
        color: styleConfig.targetColor,
        sizePx: Math.max(13, Math.round(styleConfig.targetFontSize * 0.42)),
        weight: 600,
        label: 'Target',
      };
    }
    if (!learning.showPhonetic) return null;
    return {
      text: activeCue.phoneticText,
      color: styleConfig.phoneticColor,
      sizePx: Math.max(11, Math.round(styleConfig.phoneticFontSize * 0.42)),
      weight: 500,
      label: 'Phonetic',
    };
  };

  const visibleLines = activeCue
    ? styleConfig.lineOrder
        .map((role) => {
          const line = getLineProps(role);
          return line && line.text ? { role, ...line } : null;
        })
        .filter((l): l is NonNullable<typeof l> => Boolean(l))
    : [];

  const marginPercent = Math.max(3, Math.min(18, Math.round((styleConfig.marginV / 1080) * 100)));

  const handleReplayCue = () => {
    if (cues.length === 0) return;
    tickStateRef.current.elapsedMs = 0;
    tickStateRef.current.pauseRemainingMs = 0;
    setPauseRemainingMs(0);
    setElapsedMs(0);
    setManualWord(null);
    setIsPlaying(true);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Stage header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
          <Film className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="font-semibold text-slate-900 truncate">
            {title || '16:9 Subtitle Stage Preview'}
          </span>
          {activeCue && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap">
                Cue {safeIndex + 1}/{cues.length}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setControlsOpen((o) => !o)}
            aria-expanded={controlsOpen}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              controlsOpen
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Learning Controls
          </button>

          <div className="flex items-center gap-1 bg-slate-200/70 p-0.5 rounded-lg">
            {(['cafe', 'train', 'matte'] as BackdropMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setImgFailed(false);
                  setBackdrop(mode);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  backdrop === mode
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode === 'cafe' ? 'Cafe Frame' : mode === 'train' ? 'Train Frame' : 'Matte Black'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Collapsible Learning Controls Panel (hidden by default until requested) */}
      {controlsOpen && (
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5 text-xs text-slate-700">
          <div className="flex flex-wrap items-center gap-3.5">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={learning.showTarget}
                onChange={(e) => updateLearning({ showTarget: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Original / Target</span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={learning.showBase}
                onChange={(e) => updateLearning({ showBase: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Translation</span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={learning.showPhonetic}
                onChange={(e) => updateLearning({ showPhonetic: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Pronunciation</span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={learning.highlightWords}
                onChange={(e) => updateLearning({ highlightWords: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Word Highlight</span>
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={learning.repeatCurrentCue}
                onChange={(e) => updateLearning({ repeatCurrentCue: e.target.checked })}
                className="rounded border-slate-300 text-blue-600"
              />
              <span>Repeat Cue</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5">
              <span className="text-slate-600 font-medium">Speed</span>
              <select
                aria-label="Subtitle display speed"
                value={learning.playbackSpeed}
                onChange={(e) => updateLearning({ playbackSpeed: Number(e.target.value) })}
                className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-900"
              >
                <option value={0.5}>0.5x</option>
                <option value={0.75}>0.75x</option>
                <option value={1}>1.0x</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
              </select>
            </label>

            <label className="inline-flex items-center gap-1.5">
              <span className="text-slate-600 font-medium">Pause</span>
              <select
                aria-label="Pause between subtitle cues"
                value={learning.pauseBetweenCuesMs}
                onChange={(e) =>
                  updateLearning({ pauseBetweenCuesMs: Number(e.target.value) })
                }
                className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-900"
              >
                <option value={0}>None</option>
                <option value={500}>0.5s</option>
                <option value={1000}>1.0s</option>
                <option value={1500}>1.5s</option>
                <option value={2000}>2.0s</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {/* 16:9 Cinema Stage */}
      <div className="relative w-full aspect-video bg-slate-950 overflow-hidden select-none">
        {backdropSrc && !imgFailed ? (
          <img
            src={backdropSrc}
            alt="Cinema subtitle preview frame"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900 via-slate-950 to-black" />
        )}

        {/* Measured cinema scrim for guaranteed >=4.5:1 subtitle contrast */}
        <div
          className={`absolute inset-0 pointer-events-none ${
            styleConfig.alignment === 8
              ? 'bg-gradient-to-b from-black/75 via-black/25 to-black/35'
              : 'bg-gradient-to-t from-black/85 via-black/30 to-black/20'
          }`}
        />

        {/* Inter-cue Shadowing Pause Indicator */}
        {isPlaying && pauseRemainingMs > 0 && (
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-black/75 border border-white/20 text-xs font-mono tabular-nums text-amber-300">
            Shadowing pause · {(pauseRemainingMs / 1000).toFixed(1)}s
          </div>
        )}

        {/* Subtitle Overlay Container */}
        <div
          className={`absolute inset-x-0 px-6 flex flex-col items-center ${
            learning.highlightWords ? '' : 'pointer-events-none'
          } ${styleConfig.alignment === 8 ? 'justify-start' : 'justify-end'}`}
          style={{
            top: styleConfig.alignment === 8 ? `${marginPercent}%` : undefined,
            bottom: styleConfig.alignment === 2 ? `${marginPercent}%` : undefined,
          }}
        >
          {activeCue ? (
            visibleLines.length > 0 ? (
              <div
                className="max-w-[88%] text-center rounded-lg transition-all duration-150"
                style={{
                  backgroundColor: styleConfig.opaqueBox
                    ? `rgba(9, 13, 22, ${styleConfig.boxOpacity / 100})`
                    : 'transparent',
                  padding: styleConfig.opaqueBox ? '10px 18px' : '4px 8px',
                  fontFamily: styleConfig.fontFamily,
                }}
              >
                <div
                  className="flex flex-col items-center"
                  style={{ gap: `${Math.max(2, Math.round(styleConfig.lineSpacing * 0.6))}px` }}
                >
                  {visibleLines.map((line) => {
                    const outlinePx = styleConfig.opaqueBox
                      ? 0
                      : Math.max(0.5, styleConfig.outlineWidth * 0.45);
                    const tokens = learning.highlightWords
                      ? tokenizeCueWords(line.text)
                      : [];
                    const activeWordIdx = learning.highlightWords
                      ? isPlaying && pauseRemainingMs === 0
                        ? getActiveWordIndex(tokens, elapsedMs, effectiveDurationMs)
                        : manualWord?.role === line.role
                          ? manualWord.index
                          : manualWord
                            ? -1
                            : 0
                      : -1;

                    return (
                      <div
                        key={line.role}
                        style={{
                          color: line.color,
                          fontSize: `${line.sizePx}px`,
                          fontWeight: line.weight,
                          lineHeight: 1.32,
                          textShadow: styleConfig.opaqueBox
                            ? 'none'
                            : `0 1px 2px rgba(0,0,0,0.95), 0 0 ${Math.max(2, outlinePx * 2)}px rgba(0,0,0,0.9)`,
                        }}
                      >
                        {learning.highlightWords && tokens.length > 0 ? (
                          <span className="inline-flex flex-wrap justify-center gap-x-1">
                            {tokens.map((token, tIdx) => {
                              const isActiveWord = tIdx === activeWordIdx;
                              return (
                                <button
                                  key={`${line.role}-${tIdx}`}
                                  type="button"
                                  onClick={() => setManualWord({ role: line.role, index: tIdx })}
                                  className={`rounded px-0.5 transition-colors cursor-pointer ${
                                    isActiveWord
                                      ? 'bg-white/25 underline decoration-2 underline-offset-2'
                                      : 'opacity-80 hover:opacity-100'
                                  }`}
                                >
                                  {token}
                                </button>
                              );
                            })}
                          </span>
                        ) : (
                          line.text
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/80 border border-slate-700/80 rounded-lg px-4 py-2 text-xs text-slate-300">
                All subtitle lines are hidden in Learning Controls.
              </div>
            )
          ) : (
            <div className="bg-slate-900/80 border border-slate-700/80 rounded-lg px-5 py-3 text-center">
              <p className="text-sm font-medium text-slate-200">
                Upload a subtitle file or load a sample to preview three-line playback
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Base translation (White) · Target dialogue (Yellow) · Phonetics (Cyan)
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Transport & Scrub Bar */}
      <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={cues.length === 0}
            onClick={() => {
              setPauseRemainingMs(0);
              setIsPlaying((p) => !p);
            }}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <button
            type="button"
            disabled={cues.length === 0}
            onClick={handleReplayCue}
            aria-label="Replay current cue"
            title="Replay current cue"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Repeat className="w-3.5 h-3.5" />
            Replay
          </button>

          <button
            type="button"
            disabled={cues.length === 0 || safeIndex <= 0}
            onClick={() => {
              setIsPlaying(false);
              setPauseRemainingMs(0);
              onSelectCueIndex(Math.max(0, safeIndex - 1));
            }}
            aria-label="Previous cue"
            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            disabled={cues.length === 0 || safeIndex >= cues.length - 1}
            onClick={() => {
              setIsPlaying(false);
              setPauseRemainingMs(0);
              onSelectCueIndex(Math.min(cues.length - 1, safeIndex + 1));
            }}
            aria-label="Next cue"
            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            disabled={cues.length === 0 || safeIndex === 0}
            onClick={() => {
              setIsPlaying(false);
              setPauseRemainingMs(0);
              onSelectCueIndex(0);
            }}
            aria-label="Reset to first cue"
            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 min-w-[160px] flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(0, cues.length - 1)}
            value={safeIndex}
            disabled={cues.length === 0}
            onChange={(e) => {
              setIsPlaying(false);
              setPauseRemainingMs(0);
              onSelectCueIndex(Number(e.target.value));
            }}
            aria-label="Scrub subtitle cues"
            className="w-full accent-blue-600 cursor-pointer"
          />
        </div>

        <div className="font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
          {activeCue
            ? `${formatDisplayTime(activeCue.startMs)} --> ${formatDisplayTime(activeCue.endMs)}`
            : '00:00:00.000 --> 00:00:00.000'}
        </div>
      </div>
    </div>
  );
}
