// Every sound is made here, in code, with Web Audio: no files, no outside requests.
// Short and quiet on purpose: the game is mostly pencil and paper.

type Mix = {c: AudioContext; out: GainNode; noise: AudioBuffer}

let mix: Mix | undefined
let on = true

export const soundOn = (): boolean => on
export function setSound(v: boolean): void {
  on = v
  if (!v && mix) void mix.c.suspend()
}

/** The audio graph, made on first use (always inside a tap or key press). */
function ready(): Mix | undefined {
  if (!on) return undefined
  if (!mix) {
    let c: AudioContext
    try {
      c = new AudioContext()
    } catch {
      on = false
      return undefined
    }
    const out = c.createGain()
    out.gain.value = 0.6
    out.connect(c.destination)
    const noise = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    mix = {c, out, noise}
  }
  if (mix.c.state === 'suspended') void mix.c.resume()
  return mix
}

/** A burst of filtered noise: pencil, eraser, footstep, the paper of the stamp. */
function rustle(
  m: Mix,
  at: number,
  dur: number,
  freq: number,
  q: number,
  gain: number,
  kind: BiquadFilterType = 'bandpass',
): void {
  const src = m.c.createBufferSource()
  src.buffer = m.noise
  const f = m.c.createBiquadFilter()
  f.type = kind
  f.frequency.value = freq
  f.Q.value = q
  const g = m.c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.008, dur / 4))
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(f).connect(g).connect(m.out)
  src.start(at, Math.random() * 0.8)
  src.stop(at + dur + 0.02)
}

/** One pitched note, optionally sliding to another pitch. */
function note(
  m: Mix,
  at: number,
  freq: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'sine',
  slideTo?: number,
): void {
  const o = m.c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur)
  const g = m.c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(m.out)
  o.start(at)
  o.stop(at + dur + 0.02)
}

function play(fn: (m: Mix, t: number) => void, delay = 0): void {
  const m = ready()
  if (m) fn(m, m.c.currentTime + delay)
}

export const sfx = {
  /** A pencil stroke as the line grows by one square. */
  step: (): void =>
    play((m, t) => rustle(m, t, 0.05, 2600 + Math.random() * 900, 1.4, 0.09)),
  /** Holding a beat: a soft tick, like a clock. */
  hold: (): void => play((m, t) => note(m, t, 1320, 0.035, 0.035, 'triangle')),
  /** A move the vault refuses: a dull knock. */
  blocked: (): void => play((m, t) => note(m, t, 150, 0.12, 0.22, 'sine', 90)),
  /** Undo: the eraser. */
  undo: (): void => play((m, t) => rustle(m, t, 0.08, 1100, 0.9, 0.06)),
  /** Lifting the loot: the bell. A struck bell's partials are not whole multiples. */
  bell: (): void =>
    play((m, t) => {
      for (const [ratio, gain, dur] of [
        [1, 0.16, 1.6],
        [2, 0.07, 1.1],
        [2.76, 0.06, 0.8],
        [5.4, 0.03, 0.4],
      ] as const)
        note(m, t, 740 * ratio, dur, gain)
      rustle(m, t, 0.03, 5000, 0.8, 0.05)
    }),
  /** A footstep during the run. */
  foot: (): void =>
    play((m, t) =>
      rustle(m, t, 0.06, 420 + Math.random() * 120, 0.8, 0.14, 'lowpass'),
    ),
  /** The stamp lands on the card; a ghost line earns a little chime after. */
  stamp: (ghost: boolean, delay: number): void =>
    play((m, t) => {
      note(m, t, 170, 0.18, 0.4, 'sine', 55)
      rustle(m, t, 0.07, 900, 0.7, 0.18, 'lowpass')
      if (ghost) {
        note(m, t + 0.22, 1047, 0.5, 0.05, 'triangle')
        note(m, t + 0.32, 1568, 0.7, 0.045, 'triangle')
      }
    }, delay),
}
