"use client";
import { fmt } from "@/engine";

interface Props {
  clock: number;
  min: number;
  max: number;
  playing: boolean;
  onClock: (t: number) => void;
  onPlay: () => void;
  maxWave: number;
  revealWave: number | null;
  onPlayCascade: () => void;
  onSkip: () => void;
}

export function ClockBar({ clock, min, max, playing, onClock, onPlay, maxWave, revealWave, onPlayCascade, onSkip }: Props) {
  const waves = maxWave + 1;
  return (
    <div className="clockbar">
      <button className="btn btn-small" onClick={onPlay} aria-pressed={playing}>
        {playing ? "Pause the day" : "Run the day"}
      </button>
      <label className="sr-only" htmlFor="clock">
        Time of day (IST)
      </label>
      <input
        id="clock"
        type="range"
        min={min}
        max={max}
        step={5}
        value={clock}
        onChange={(e) => onClock(Number(e.target.value))}
        aria-valuetext={`${fmt(clock)} IST`}
      />
      <span className="clock-time" aria-live="off">
        {fmt(clock)} <small style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)" }}>IST</small>
      </span>
      {revealWave !== null ? (
        <>
          <span className="wave-counter" aria-live="polite">
            {revealWave < 0 ? "Schedule as planned" : `Wave ${revealWave + 1} of ${waves}`}
          </span>
          <button className="btn btn-small" onClick={onSkip}>
            Skip
          </button>
        </>
      ) : (
        <button className="btn btn-small btn-primary" onClick={onPlayCascade} disabled={waves <= 0}>
          Play the cascade
        </button>
      )}
    </div>
  );
}
