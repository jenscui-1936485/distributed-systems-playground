import { useEffect, useState } from 'react';

const SPEEDS = [0.5, 1, 2, 4];

export function usePlayback(length: number, resetKey: string) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [resetKey]);

  useEffect(() => {
    if (!playing) return undefined;
    const delay = 560 / speed;
    const id = window.setInterval(() => {
      setIndex((current) => (current >= length - 1 ? current : current + 1));
    }, delay);
    return () => window.clearInterval(id);
  }, [playing, speed, length]);

  useEffect(() => {
    if (playing && index >= length - 1) setPlaying(false);
  }, [playing, index, length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPlaying(false);
        setIndex((current) => Math.min(length - 1, current + 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPlaying(false);
        setIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPlaying(false);
        setIndex(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [length]);

  return {
    index: Math.min(index, Math.max(0, length - 1)),
    setIndex,
    playing,
    setPlaying,
    speed,
    setSpeed,
  };
}

export function Playback({
  index,
  length,
  tick,
  playing,
  speed,
  onPlay,
  onIndex,
  onSpeed,
}: {
  index: number;
  length: number;
  tick: number;
  playing: boolean;
  speed: number;
  onPlay: (playing: boolean) => void;
  onIndex: (index: number) => void;
  onSpeed: (speed: number) => void;
}) {
  const last = Math.max(0, length - 1);
  return (
    <div className="playback" role="group" aria-label="Playback">
      <div className="playback-buttons">
        <button type="button" className="button ghost" onClick={() => { onPlay(false); onIndex(0); }}>
          Restart
        </button>
        <button type="button" className="button ghost icon-button" aria-label="Step back" onClick={() => { onPlay(false); onIndex(Math.max(0, index - 1)); }}>
          ←
        </button>
        <button
          type="button"
          className="button primary"
          aria-pressed={playing}
          onClick={() => {
            if (!playing && index >= last) {
              onIndex(0);
              onPlay(true);
              return;
            }
            onPlay(!playing);
          }}
        >
          {playing ? 'Pause' : index >= last ? 'Replay' : 'Play'}
        </button>
        <button type="button" className="button ghost icon-button" aria-label="Step forward" onClick={() => { onPlay(false); onIndex(Math.min(last, index + 1)); }}>
          →
        </button>
      </div>
      <div className="speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            className={`speed${speed === value ? ' on' : ''}`}
            aria-pressed={speed === value}
            onClick={() => onSpeed(value)}
          >
            {value}×
          </button>
        ))}
      </div>
      <label className="scrub">
        <span>Tick {tick} / {last}</span>
        <input
          type="range"
          min={0}
          max={last}
          value={Math.min(index, last)}
          aria-label="Scrub the timeline"
          onChange={(event) => {
            onPlay(false);
            onIndex(Number(event.target.value));
          }}
        />
      </label>
      <p className="kbd-hint">Space plays and pauses. Arrow keys step. Home returns to the start.</p>
    </div>
  );
}
