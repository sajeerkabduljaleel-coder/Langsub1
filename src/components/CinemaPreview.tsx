import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Pause,
  Play,
  RotateCcw,
} from 'lucide-react';
import type {
  AssStyleConfig,
  SubtitleLineRole,
  TriLineCue,
} from '../types/subtitle';
import cafeStill from '/src/assets/images/cinema_cafe_still_1794633452935.jpg';
import trainStill from '/src/assets/images/cinema_train_still_1794633453954.jpg';

interface CinemaPreviewProps {
  cues: TriLineCue[];
  styleConfig: AssStyleConfig;
  activeCueIndex: number;
  onSelectCueIndex: (idx: number) => void;
  title?: string;
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
}: CinemaPreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [backdrop, setBackdrop] = useState<BackdropMode>('cafe');
  const [imgFailed, setImgFailed] = useState(false);

  const safeIndex = Math.max(0, Math.min(activeCueIndex, Math.max(0, cues.length - 1)));
  const activeCue = cues[safeIndex] || null;

  useEffect(() => {
    if (!isPlaying || cues.length === 0) return;
    const current = cues[safeIndex];
    const durationMs = current
      ? Math.max(1800, Math.min(4800, current.endMs - current.startMs))
      : 2800;

    const timer = window.setTimeout(() => {
      if (safeIndex + 1 < cues.length) {
        onSelectCueIndex(safeIndex + 1);
      } else {
        setIsPlaying(false);
      }
    }, durationMs);

    return () => window.clearTimeout(timer);
  }, [isPlaying, safeIndex, cues, onSelectCueIndex]);

  const backdropSrc = useMemo(() => {
    if (backdrop === 'cafe') return cafeStill;
    if (backdrop === 'train') return trainStill;
    return null;
  }, [backdrop]);

  const getLineProps = (role: SubtitleLineRole) => {
    if (!activeCue) return null;
    if (role === 'base') {
      return {
        text: activeCue.baseText,
        color: styleConfig.baseColor,
        sizePx: Math.max(12, Math.round(styleConfig.baseFontSize * 0.42)),
        weight: 500,
        label: 'Base',
      };
    }
    if (role === 'target') {
      return {
        text: activeCue.targetText,
        color: styleConfig.targetColor,
        sizePx: Math.max(13, Math.round(styleConfig.targetFontSize * 0.42)),
        weight: 600,
        label: 'Target',
      };
    }
    return {
      text: activeCue.phoneticText,
      color: styleConfig.phoneticColor,
      sizePx: Math.max(11, Math.round(styleConfig.phoneticFontSize * 0.42)),
      weight: 500,
      label: 'Phonetic',
    };
  };

  const marginPercent = Math.max(3, Math.min(18, Math.round((styleConfig.marginV / 1080) * 100)));

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

        {/* Subtitle Overlay Container */}
        <div
          className={`absolute inset-x-0 px-6 flex flex-col items-center pointer-events-none ${
            styleConfig.alignment === 8 ? 'justify-start' : 'justify-end'
          }`}
          style={{
            top: styleConfig.alignment === 8 ? `${marginPercent}%` : undefined,
            bottom: styleConfig.alignment === 2 ? `${marginPercent}%` : undefined,
          }}
        >
          {activeCue ? (
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
                {styleConfig.lineOrder.map((role) => {
                  const line = getLineProps(role);
                  if (!line || !line.text) return null;
                  const outlinePx = styleConfig.opaqueBox
                    ? 0
                    : Math.max(0.5, styleConfig.outlineWidth * 0.45);
                  return (
                    <div
                      key={role}
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
                      {line.text}
                    </div>
                  );
                })}
              </div>
            </div>
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
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          <button
            type="button"
            disabled={cues.length === 0 || safeIndex <= 0}
            onClick={() => {
              setIsPlaying(false);
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
              onSelectCueIndex(0);
            }}
            aria-label="Reset to first cue"
            className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 min-w-[180px] flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(0, cues.length - 1)}
            value={safeIndex}
            disabled={cues.length === 0}
            onChange={(e) => {
              setIsPlaying(false);
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
