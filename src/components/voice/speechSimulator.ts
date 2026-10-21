/**
 * Synthetic speech loudness, shaped like the real thing rather than random noise.
 *
 * Speech energy is modulated at the syllable rate (~4–5 Hz). Syllables group into
 * words, words into phrases, and phrases are separated by pauses. Loudness also
 * drifts down across a phrase ("declination"). Reproducing that rhythm is what makes
 * a fake waveform read as a person talking instead of static.
 */

/** Small, fast, seedable PRNG so the demo is reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SpeechSimulator {
  /** Advance by `dt` seconds and return loudness in 0..1. */
  sample(dt: number): number;
}

export function createSpeechSimulator(seed = 0x5eed): SpeechSimulator {
  const rnd = mulberry32(seed);
  const range = (a: number, b: number) => a + (b - a) * rnd();
  const int = (a: number, b: number) => Math.floor(range(a, b + 1));

  let t = 0;
  let segT = 0;
  // Open with a short silence so the first bars rise naturally.
  let segDur = 0.18;
  let segPeak = 0;
  let voiced = false;
  let syllablesLeft = 0;
  let wordsLeft = 0;
  let wordIndex = 0;
  let phraseGain = 1;

  function nextSegment() {
    if (voiced) {
      voiced = false;
      segPeak = 0;
      if (syllablesLeft > 0) segDur = range(0.012, 0.045); // within a word
      else if (wordsLeft > 0) segDur = range(0.05, 0.16); // between words
      else segDur = range(0.38, 0.95); // phrase pause / breath
      return;
    }
    if (syllablesLeft === 0) {
      if (wordsLeft === 0) {
        wordsLeft = int(3, 9);
        wordIndex = 0;
        phraseGain = range(0.7, 1);
      }
      wordsLeft--;
      wordIndex++;
      syllablesLeft = int(1, 3);
    }
    const stressed = rnd() < 0.3;
    const declination = Math.max(0.55, 1 - 0.055 * wordIndex);
    syllablesLeft--;
    voiced = true;
    segDur = range(0.09, 0.2);
    segPeak = phraseGain * declination * range(0.5, 0.9) * (stressed ? 1.2 : 1);
  }

  return {
    sample(dt) {
      t += dt;
      segT += dt;
      while (segT >= segDur) {
        segT -= segDur;
        nextSegment();
      }
      const x = segT / segDur;
      // Skewed bump: fast consonant onset, slower vowel decay.
      const env = voiced ? Math.sin(Math.PI * Math.pow(x, 0.6)) * segPeak : 0;
      // Vocal tremor + a little breath noise so silence isn't dead flat.
      const tremor = 1 + 0.1 * Math.sin(t * Math.PI * 2 * 7.3) + 0.08 * (rnd() - 0.5);
      const breath = 0.025 * rnd();
      return Math.min(1, Math.max(0, env * tremor + breath));
    },
  };
}
