import { useRef, useState, useEffect } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import { clsx } from 'clsx';

interface AudioPlayerProps {
  src: string;
  duration?: number;
  className?: string;
  compact?: boolean;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ src, duration, className, compact = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration ?? 0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handlers = {
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      ended: () => { setPlaying(false); setCurrentTime(0); },
      timeupdate: () => setCurrentTime(audio.currentTime),
      durationchange: () => setTotalDuration(audio.duration),
      waiting: () => setLoading(true),
      canplay: () => setLoading(false),
    };
    Object.entries(handlers).forEach(([e, h]) => audio.addEventListener(e, h));
    return () => Object.entries(handlers).forEach(([e, h]) => audio.removeEventListener(e, h));
  }, []);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      await audio.play().catch(() => null);
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = Number(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  };

  const pct = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  if (compact) {
    return (
      <div className={clsx('flex items-center gap-2', className)}>
        <audio ref={audioRef} src={src} preload="metadata" />
        <button
          onClick={toggle}
          className="w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center text-white hover:bg-primary-700 flex-shrink-0"
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <span className="text-xs text-surface-500 tabular-nums">
          {formatTime(currentTime)} / {formatTime(totalDuration)}
        </span>
      </div>
    );
  }

  return (
    <div className={clsx('flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl', className)}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        onClick={toggle}
        disabled={loading}
        className="w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center text-white hover:bg-primary-700 disabled:opacity-50 flex-shrink-0"
      >
        {loading ? (
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : playing ? (
          <Pause size={14} />
        ) : (
          <Play size={14} />
        )}
      </button>

      {/* Progress */}
      <div className="flex-1 flex flex-col gap-1">
        <input
          type="range"
          min={0}
          max={totalDuration || 1}
          value={currentTime}
          onChange={seek}
          className="w-full h-1 accent-primary-600 cursor-pointer"
          style={{
            background: `linear-gradient(to right, rgb(79,70,229) ${pct}%, rgb(203,213,225) ${pct}%)`,
          }}
        />
        <div className="flex justify-between text-2xs text-surface-400 tabular-nums">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
      </div>

      <a
        href={src}
        download
        className="btn-ghost btn-icon flex-shrink-0"
        title="Download"
      >
        <Download size={14} />
      </a>
    </div>
  );
}
