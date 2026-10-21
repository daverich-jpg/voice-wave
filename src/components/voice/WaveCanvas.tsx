import { useEffect, useRef } from "react";
import type { LevelSource } from "./levelSources";

export type VoiceState = "idle" | "listening" | "processing";

export interface WaveStats {
  fps: number;
  /** Smoothed loudness 0..1 currently driving the newest bar. */
  level: number;
  /** Raw mic reading in dBFS, when the mic is live. */
  db: number | null;
  bars: number;
}

interface WaveCanvasProps {
  state: VoiceState;
  sourceRef: React.MutableRefObject<LevelSource | null>;
  reducedMotion: boolean;
  /** Receives the smoothed level every frame (e.g. to drive a glow). */
  onLevel?: (level: number) => void;
  statsRef?: React.MutableRefObject<WaveStats>;
  className?: string;
}

// Geometry from the Figma frame: 1px bars on a 4px pitch, 6px tall at rest.
const PITCH = 4;
const BAR_W = 1;
const MIN_H = 6;
const V_PAD = 2;
/** Seconds of audio per bar. 96 bars ≈ 3.8 s of history on screen. */
const STEP = 0.04;
// Meter ballistics: snap up on transients, fall back gently.
const ATTACK = 0.018;
const RELEASE = 0.075;
/** How quickly each drawn bar chases its target height / opacity. */
const HEIGHT_TAU = 0.06;
const ALPHA_TAU = 0.14;

/** Frame-rate independent lerp factor: same feel at 60, 120 or 30 Hz. */
const follow = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function readInk(el: HTMLElement) {
  return getComputedStyle(el).getPropertyValue("--vw-ink").trim() || "#fff";
}

/**
 * A scrolling loudness history, newest sample on the right, like a dictation
 * waveform. Every bar eases toward its target, so state changes (rise, collapse,
 * shimmer) all fall out of one loop with no special-cased transitions.
 */
export function WaveCanvas({ state, sourceRef, reducedMotion, onLevel, statsRef, className }: WaveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const reducedRef = useRef(reducedMotion);
  const onLevelRef = useRef(onLevel);
  stateRef.current = state;
  reducedRef.current = reducedMotion;
  onLevelRef.current = onLevel;

  // Clear history when a new take starts, so it doesn't open on stale audio.
  const resetRef = useRef(false);
  useEffect(() => {
    if (state === "listening") resetRef.current = true;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let n = 0;
    let history = new Float32Array(0);
    let heights = new Float32Array(0);
    let alphas = new Float32Array(0);
    let ink = readInk(canvas);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      cssW = rect.width;
      cssH = rect.height;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      const next = Math.max(1, Math.floor((cssW - BAR_W) / PITCH) + 1);
      if (next !== n) {
        // Keep the newest samples (right-aligned) when the width changes.
        const keep = (src: Float32Array, fill: number) => {
          const out = new Float32Array(next).fill(fill);
          const k = Math.min(next, src.length);
          out.set(src.subarray(src.length - k), next - k);
          return out;
        };
        history = keep(history, 0);
        heights = keep(heights, MIN_H);
        alphas = keep(alphas, 0);
        n = next;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Re-read the bar colour only when the theme actually changes.
    const refreshInk = () => (ink = readInk(canvas));
    const mo = new MutationObserver(refreshInk);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", refreshInk);

    let level = 0;
    let peak = 0;
    let acc = 0;
    let t = 0;
    let fps = 60;
    let last = performance.now();
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // Clamp so a backgrounded tab doesn't lurch on return.
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      t += dt;
      fps += (1 / dt - fps) * follow(dt, 0.5);

      const mode = stateRef.current;
      const reduced = reducedRef.current;
      const src = sourceRef.current;

      if (resetRef.current) {
        resetRef.current = false;
        history.fill(0);
        level = peak = acc = 0;
      }

      // 1. Loudness → envelope follower → scrolling history.
      if (mode === "listening") {
        const raw = src ? src.read(dt) : 0;
        level += (raw - level) * follow(dt, raw > level ? ATTACK : RELEASE);
        // Hold the loudest moment in each step so short syllables aren't missed.
        peak = Math.max(peak, level);
        acc += dt;
        while (acc >= STEP) {
          acc -= STEP;
          history.copyWithin(0, 1);
          history[n - 1] = peak;
          peak = level;
        }
      } else {
        level += (0 - level) * follow(dt, RELEASE);
      }
      onLevelRef.current?.(level);

      // 2. Per-bar targets for the current state, then ease toward them.
      const maxH = Math.max(MIN_H, cssH - V_PAD * 2);
      const kH = follow(dt, HEIGHT_TAU);
      const kA = follow(dt, ALPHA_TAU);
      // Processing shimmer: a soft band sweeping left → right.
      const sweepPeriod = 1.6;
      const sweep = ((t % sweepPeriod) / sweepPeriod) * (n + 30) - 15;

      for (let i = 0; i < n; i++) {
        let h = MIN_H;
        let a: number;
        if (mode === "listening") {
          // Slight expansion so conversational speech fills the pill, not just shouts.
          h = MIN_H + (maxH - MIN_H) * Math.pow(history[i], 0.8);
          // Oldest audio fades off the left edge.
          a = 0.3 + 0.65 * smoothstep(0, 14, i);
        } else if (mode === "processing") {
          if (reduced) {
            a = 0.45;
          } else {
            const d = (i - sweep) / 6;
            const g = Math.exp(-d * d);
            h = MIN_H + 7 * g;
            a = 0.22 + 0.73 * g;
          }
        } else {
          // Idle: a slow breath travelling across the line.
          a = reduced ? 0.4 : 0.34 + 0.16 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 3.6 - i * 0.07));
        }
        heights[i] += (h - heights[i]) * kH;
        alphas[i] += (a - alphas[i]) * kA;
      }

      // 3. Draw, snapped to device pixels so 1px bars stay crisp.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = ink;
      const bw = Math.max(1, Math.round(BAR_W * dpr));
      for (let i = 0; i < n; i++) {
        const hd = Math.max(2, Math.round((heights[i] * dpr) / 2) * 2);
        ctx.globalAlpha = alphas[i];
        ctx.fillRect(Math.round(i * PITCH * dpr), Math.round((canvas.height - hd) / 2), bw, hd);
      }
      ctx.globalAlpha = 1;

      if (statsRef) {
        statsRef.current.fps = fps;
        statsRef.current.level = level;
        statsRef.current.db = src?.db ?? null;
        statsRef.current.bars = n;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener("change", refreshInk);
    };
  }, [sourceRef, statsRef]);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
