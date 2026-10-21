import { createSpeechSimulator } from "./speechSimulator";

export type SourceKind = "mic" | "sim";

/** Anything that can report "how loud is it right now", polled once per frame. */
export interface LevelSource {
  kind: SourceKind;
  /** Advance by `dt` seconds; returns normalised loudness 0..1. */
  read(dt: number): number;
  /** Last raw reading in dBFS (mic only), for the readout. */
  db: number | null;
  dispose(): void;
}

export function openSimSource(seed?: number): LevelSource {
  const sim = createSpeechSimulator(seed);
  return { kind: "sim", db: null, read: (dt) => sim.sample(dt), dispose() {} };
}

export class MicUnavailableError extends Error {}

/**
 * Live microphone loudness via getUserMedia + AnalyserNode.
 *
 * Raw RMS is mapped to 0..1 like a broadcast meter rather than linearly:
 *  - work in dBFS, because loudness perception is logarithmic;
 *  - track the room's noise floor (fast down, slow up) and gate just above it,
 *    so a fan or laptop hum reads as silence instead of a permanent wobble;
 *  - track a ceiling (instant up, slow release) so a quiet mic still fills the bars.
 */
export async function openMicSource(): Promise<LevelSource> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new MicUnavailableError("Microphone needs HTTPS or localhost");
  }
  const AudioCtx: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new MicUnavailableError("Web Audio isn't supported here");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    const reason =
      name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone permission was denied"
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "No microphone found"
          : name === "NotReadableError"
            ? "Microphone is in use by another app"
            : "Microphone unavailable";
    throw new MicUnavailableError(reason);
  }

  const ctx = new AudioCtx();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024; // ~21 ms window at 48 kHz: about one frame of audio
  analyser.smoothingTimeConstant = 0; // we do our own ballistics
  const input = ctx.createMediaStreamSource(stream);
  input.connect(analyser); // analyser only — never routed to the speakers

  const buf = new Float32Array(analyser.fftSize);
  let noiseFloor = -55;
  let ceiling = -24;

  const source: LevelSource = {
    kind: "mic",
    db: null,
    read(dt) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const db = Math.max(-100, 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-10));
      source.db = db;

      noiseFloor = db < noiseFloor ? noiseFloor + (db - noiseFloor) * Math.min(1, dt * 4) : noiseFloor + 1.5 * dt;
      noiseFloor = Math.min(Math.max(noiseFloor, -90), -30);
      ceiling = db > ceiling ? db : ceiling - 3 * dt;
      ceiling = Math.min(Math.max(ceiling, -34), -3);

      const floor = Math.min(noiseFloor + 6, ceiling - 18);
      const x = (db - floor) / (ceiling - floor);
      return x <= 0 ? 0 : Math.min(1, Math.pow(x, 1.2));
    },
    dispose() {
      input.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    },
  };
  return source;
}
