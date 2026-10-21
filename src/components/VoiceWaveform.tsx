import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { WaveCanvas, type VoiceState, type WaveStats } from "./voice/WaveCanvas";
import { useLevelSource } from "./voice/useLevelSource";
import type { SourceKind } from "./voice/levelSources";
import plusIcon from "../assets/plus.svg";
import stopIcon from "../assets/stop.svg";
import arrowUpIcon from "../assets/arrow-up.svg";

export type { VoiceState, WaveStats, SourceKind };

export interface VoiceWaveformProps {
  /** "mic" tries the live microphone and falls back to simulation; "sim" always simulates. */
  source?: SourceKind;
  /** How long the processing state lasts before returning to idle. */
  processingMs?: number;
  onStateChange?: (state: VoiceState) => void;
  /** Live render stats (fps, level, dB), written every frame without re-rendering. */
  statsRef?: React.MutableRefObject<WaveStats>;
  className?: string;
}

type ProcessingKind = "transcribing" | "thinking";

const ease = [0.23, 1, 0.32, 1] as const; // strong ease-out
const swap = {
  initial: { opacity: 0, scale: 0.6, filter: "blur(2px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.6, filter: "blur(2px)" },
  transition: { duration: 0.18, ease },
};

function MicIcon() {
  // Drawn to match the Phosphor-regular icons used in the design (18px, 1.125 stroke).
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="6.1875" y="1.6875" width="5.625" height="9.5625" rx="2.8125" stroke="white" strokeWidth="1.125" />
      <path d="M14.0625 9a5.0625 5.0625 0 0 1-10.125 0M9 14.0625v2.25" stroke="white" strokeWidth="1.125" strokeLinecap="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden className="vw-spin">
      <circle cx="9" cy="9" r="6.1875" stroke="white" strokeOpacity="0.25" strokeWidth="1.5" />
      <path d="M9 2.8125a6.1875 6.1875 0 0 1 6.1875 6.1875" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const iconBtn =
  "relative grid size-8 shrink-0 place-items-center rounded-full outline-none transition-[transform,background-color] duration-150 ease-out active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-(--vw-focus) focus-visible:ring-offset-2 focus-visible:ring-offset-(--vw-pill)";

/**
 * Voice composer: idle → listening → processing, with a waveform driven by the
 * live microphone or by simulated speech.
 */
export function VoiceWaveform({ source = "mic", processingMs = 2400, onStateChange, statsRef, className = "" }: VoiceWaveformProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [processing, setProcessing] = useState<ProcessingKind>("thinking");
  const reducedMotion = useReducedMotion() ?? false;
  const { sourceRef, activeKind, requesting, fallbackReason } = useLevelSource(state === "listening", source);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => onStateChange?.(state), [state, onStateChange]);

  // Processing is a stand-in for the round trip to a model.
  useEffect(() => {
    if (state !== "processing") return;
    const id = window.setTimeout(() => setState("idle"), processingMs);
    return () => window.clearTimeout(id);
  }, [state, processingMs]);

  // Esc abandons a recording, like every dictation UI.
  useEffect(() => {
    if (state !== "listening") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setState("idle");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  const finish = (kind: ProcessingKind) => {
    setProcessing(kind);
    setState("processing");
  };

  // Written straight to a CSS variable each frame — no React re-render.
  const onLevel = useCallback((level: number) => {
    glowRef.current?.style.setProperty("--vw-level", level.toFixed(3));
  }, []);

  const caption =
    state === "idle"
      ? "Tap the mic and start talking"
      : state === "processing"
        ? processing === "thinking"
          ? "Thinking…"
          : "Transcribing…"
        : requesting
          ? "Waiting for microphone permission…"
          : activeKind === "mic"
            ? "Listening · live microphone"
            : "Listening · simulated speech";

  return (
    <div className={`flex w-full max-w-[602px] flex-col items-center gap-8 ${className}`}>
      <h1 className="w-full text-center text-[clamp(24px,6vw,32px)] leading-[1.625] font-medium tracking-[-0.02em] text-(--vw-heading)">
        Where should we start?
      </h1>

      <div className="relative w-full">
        {/* Glow behind the pill tracks loudness while listening. */}
        <div
          ref={glowRef}
          aria-hidden
          data-state={state}
          className="vw-glow pointer-events-none absolute -inset-x-6 -inset-y-8 -z-10 rounded-full blur-2xl"
        />

        <div className="relative flex w-full items-center gap-5 overflow-clip rounded-[80px] bg-(--vw-pill) px-[18px] py-[14px] shadow-(--vw-pill-shadow) backdrop-blur-xl sm:gap-10">
          <div aria-hidden className="grid size-8 shrink-0 place-items-center">
            <img src={plusIcon} width={18} height={18} alt="" className="vw-icon" />
          </div>

          <WaveCanvas
            state={state}
            sourceRef={sourceRef}
            reducedMotion={reducedMotion}
            onLevel={onLevel}
            statsRef={statsRef}
            className="h-8 min-w-0 flex-1"
          />

          <div className="flex min-w-[74px] shrink-0 items-center justify-end gap-[10px]">
            <AnimatePresence initial={false} mode="popLayout">
              {state === "listening" && (
                <motion.button
                  key="stop"
                  {...swap}
                  type="button"
                  onClick={() => finish("transcribing")}
                  aria-label="Stop recording"
                  className={`${iconBtn} bg-(--vw-btn) hover:bg-(--vw-btn-hover)`}
                >
                  <img src={stopIcon} width={18} height={18} alt="" className="vw-icon" />
                </motion.button>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={() =>
                state === "idle" ? setState("listening") : state === "listening" ? finish("thinking") : setState("idle")
              }
              aria-label={state === "idle" ? "Start voice input" : state === "listening" ? "Send" : "Cancel"}
              className={`${iconBtn} bg-(--vw-primary) hover:bg-(--vw-primary-hover)`}
            >
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={state} {...swap} className="grid place-items-center">
                  {state === "idle" ? <MicIcon /> : state === "listening" ? <img src={arrowUpIcon} width={18} height={18} alt="" /> : <Spinner />}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-[52px] flex-col items-center gap-2 text-center">
        <p aria-live="polite" className="text-[13px] tracking-[-0.01em] text-(--vw-muted)">
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={caption}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.16, ease }}
              className="inline-block"
            >
              {caption}
            </motion.span>
          </AnimatePresence>
        </p>
        <AnimatePresence>
          {fallbackReason && source === "mic" && state === "listening" && (
            <motion.p
              role="status"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease }}
              className="rounded-full bg-(--vw-btn) px-3 py-1 text-[12px] text-(--vw-heading)"
            >
              {fallbackReason}, so this is simulated speech
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
