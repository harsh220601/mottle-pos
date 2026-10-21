#!/usr/bin/env python3
"""Mottle film score: synthesizes music and sound design from a film's cue list.

    python3 audio.py cues.json out.wav

Everything is generated here with numpy (no samples, no licensing). The film
emits cues — section changes, whooshes, impacts, UI taps — and this script
builds an arrangement around them on the film's tempo grid.
"""
import json, sys, wave
import numpy as np

SR = 48000
rng = np.random.default_rng(7)


def hz(note):
    """'A4' / 'F#3' / 'Bb2' → Hz"""
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    n = names[note[0]]
    i = 1
    if note[1] in '#b':
        n += 1 if note[1] == '#' else -1
        i = 2
    octave = int(note[i:])
    return 440.0 * 2 ** ((n + 12 * (octave + 1) - 69) / 12)


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def env_adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    e = np.full(n, s, dtype=np.float64)
    a = min(a, n); e[:a] = np.linspace(0, 1, a, endpoint=False) if a else e[:a]
    dd = min(d, n - a)
    if dd > 0: e[a:a + dd] = np.linspace(1, s, dd)
    if r > 0 and n > r: e[n - r:] *= np.linspace(1, 0, r) ** 2
    return e


# ---------- spectral helpers ----------
def fft_filter(x, lo=None, hi=None, slope=2.0):
    """Static zero-phase band filter on a mono signal via FFT."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if hi: g *= 1 / np.sqrt(1 + (f / hi) ** (2 * slope))
    if lo: g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * slope))
    return np.fft.irfft(X * g, len(x))


def sweep_filter(x, lo_curve, hi_curve, frame=1024):
    """Time-varying band filter (overlap-add STFT). curves: arrays sampled per frame (Hz)."""
    hop = frame // 2
    win = np.hanning(frame)
    n = len(x)
    out = np.zeros(n + frame)
    f = np.fft.rfftfreq(frame, 1 / SR)
    frames = (n + hop - 1) // hop
    xp = np.concatenate([x, np.zeros(frame)])
    for k in range(frames):
        p = k / max(1, frames - 1)
        i = min(int(p * (len(lo_curve) - 1)), len(lo_curve) - 1)
        lo, hi = lo_curve[i], hi_curve[i]
        seg = xp[k * hop:k * hop + frame] * win
        g = (1 / np.sqrt(1 + (f / hi) ** 4)) * (1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4))
        out[k * hop:k * hop + frame] += np.fft.irfft(np.fft.rfft(seg) * g, frame)
    return out[:n]


def reverb_ir(seconds=2.6, damp=0.55, pre=0.012):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for c in range(2):
        noise = rng.standard_normal(n)
        # darker over time: blend a lowpassed copy in as the tail decays
        dark = fft_filter(noise, hi=2500)
        mix = np.clip(t / seconds * 1.6, 0, 1) * damp
        ir[:, c] = ((1 - mix) * noise + mix * dark * 1.6) * np.exp(-t * 6.9 / seconds)
    ir[:int(pre * SR)] = 0
    return ir / np.sqrt((ir ** 2).sum(axis=0))


def convolve(x, ir):
    """x: (n,2), ir: (m,2) → (n,2) wet signal"""
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    out = np.zeros((len(x), 2))
    for c in range(2):
        y = np.fft.irfft(np.fft.rfft(x[:, c], N) * np.fft.rfft(ir[:, c], N), N)
        out[:, c] = y[:len(x)]
    return out


# ---------- instruments (return mono float arrays) ----------
def saw_voice(f, dur, cutoff=2400, detune=0.0, phase=None):
    t = tvec(dur)
    out = np.zeros_like(t)
    nmax = int(min(40, 16000 / f))
    ph = rng.uniform(0, 2 * np.pi) if phase is None else phase
    for n in range(1, nmax + 1):
        amp = (1 / n) / np.sqrt(1 + (n * f / cutoff) ** 4)
        if amp < 1e-4: break
        out += amp * np.sin(2 * np.pi * n * f * (1 + detune) * t + ph * n)
    return out


def pad(freqs, dur, cutoff=1800, attack=1.6, release=2.2, width=0.6):
    """Warm detuned chord. Returns (n,2)."""
    n = int(dur * SR)
    L = np.zeros(n); R = np.zeros(n)
    for f in freqs:
        for d, pan in ((-0.0045, -width), (0.0, 0.0), (0.0052, width)):
            v = saw_voice(f, dur, cutoff, d)[:n]
            L += v * (1 - pan) * 0.5; R += v * (1 + pan) * 0.5
    e = env_adsr(n, attack, 0.8, 0.85, release)
    # slow breathing
    t = np.arange(n) / SR
    e *= 0.88 + 0.12 * np.sin(2 * np.pi * 0.11 * t)
    s = np.stack([L * e, R * e], 1)
    return s / (len(freqs) * 3)


def pluck(f, dur=1.6, bright=1.0):
    t = tvec(dur)
    out = np.zeros_like(t)
    for n in range(1, 10):
        out += (1 / n ** 1.15) * np.exp(-t * (3.2 + n * 1.9 / bright)) * np.sin(2 * np.pi * f * n * t * (1 + 0.0004 * n * n))
    a = min(len(t), int(0.004 * SR)); out[:a] *= np.linspace(0, 1, a)
    return out * 0.5


def piano(f, dur=3.0, vel=1.0):
    t = tvec(dur)
    out = np.zeros_like(t)
    B = 0.00035
    for n in range(1, 14):
        fn = f * n * np.sqrt(1 + B * n * n)
        if fn > 15000: break
        decay = 1.1 + n * 0.55
        out += (vel ** (n * 0.15)) / n ** 1.3 * (np.exp(-t * decay) * 0.8 + 0.2 * np.exp(-t * decay * 0.25)) * np.sin(2 * np.pi * fn * t + n)
    hammer = fft_filter(rng.standard_normal(len(t)), lo=800, hi=5000) * np.exp(-t * 90) * 0.06
    a = int(0.003 * SR); out[:a] *= np.linspace(0, 1, a)
    return (out + hammer) * 0.42 * vel


def bell(f, dur=2.5):
    t = tvec(dur)
    out = np.zeros_like(t)
    for ratio, amp, dec in ((1, 1, 2.2), (2.76, 0.5, 3.6), (5.4, 0.28, 5.5), (8.93, 0.14, 8.0), (2.0, 0.3, 2.8)):
        out += amp * np.exp(-t * dec) * np.sin(2 * np.pi * f * ratio * t)
    a = int(0.002 * SR); out[:a] *= np.linspace(0, 1, a)
    return out * 0.25


def sub(f, dur):
    t = tvec(dur)
    e = env_adsr(len(t), 0.02, 0.2, 0.9, min(0.25, dur * 0.4))
    return (np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t)) * e * 0.55


def kick(vel=1.0):
    t = tvec(0.6)
    f = 46 + 110 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 6.5)
    click = fft_filter(rng.standard_normal(len(t)), lo=1500, hi=7000) * np.exp(-t * 260) * 0.45
    return (body + click) * 0.95 * vel


def hat(open_=False, vel=1.0):
    t = tvec(0.25 if open_ else 0.08)
    n = fft_filter(rng.standard_normal(len(t)), lo=7000, hi=16000)
    return n * np.exp(-t * (14 if open_ else 70)) * 0.22 * vel


def clap(vel=1.0):
    t = tvec(0.45)
    n = fft_filter(rng.standard_normal(len(t)), lo=900, hi=6000)
    e = np.exp(-t * 18)
    for d in (0.011, 0.022):  # multi-hit clap
        k = int(d * SR); e[:k] = np.maximum(e[:k], 0)
        e[k:k + 300] += 0.6
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.3
    return (n * e + tone) * 0.35 * vel


def whoosh(dur=1.0, rise=0.7, up=True):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    k = 64
    p = np.linspace(0, 1, k)
    shape = np.where(p < rise, (p / rise) ** 2, ((1 - p) / (1 - rise)) ** 1.5)
    centre = (300 + 5200 * (p if up else 1 - p) ** 1.4)
    y = sweep_filter(x, centre * 0.45, centre * 1.8)
    amp = np.interp(np.linspace(0, 1, n), p, shape)
    y = y * amp
    pan = np.interp(np.linspace(0, 1, n), [0, 1], [-0.6, 0.6] if up else [0.6, -0.6])
    return np.stack([y * (1 - pan) * 0.5, y * (1 + pan) * 0.5], 1) * 0.55


def riser(dur=2.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    p = t / dur
    x = sweep_filter(rng.standard_normal(n), 200 + 3000 * p[::max(1, n // 64)] ** 2, 800 + 9000 * p[::max(1, n // 64)] ** 2)
    f = 180 * 2 ** (p * 2.0)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    y = (x * 0.8 + tone) * p ** 2.2
    return np.stack([y, y], 1) * 0.5


def impact(vel=1.0):
    t = tvec(3.5)
    f = 28 + 60 * np.exp(-t * 7)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.4) * 0.5
    noise = fft_filter(rng.standard_normal(len(t)), lo=60, hi=3200) * np.exp(-t * 5.0) * 0.8
    y = (body + noise) * vel
    return np.stack([y, y], 1) * 0.9


def tick(vel=1.0, f=2400):
    t = tvec(0.05)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t * 160) + fft_filter(rng.standard_normal(len(t)), lo=3000) * np.exp(-t * 400) * 0.25
    return y * 0.35 * vel


def keytap(vel=1.0):
    t = tvec(0.04)
    y = fft_filter(rng.standard_normal(len(t)), lo=1800, hi=9000) * np.exp(-t * 220)
    return y * 0.22 * vel


def success(vel=1.0):
    """Two-note confirmation chime (like a soft Apple Pay tick)."""
    a = bell(hz('E6'), 1.4) ; b = bell(hz('B6'), 1.6)
    out = np.zeros(int(1.8 * SR))
    out[:len(a)] += a
    k = int(0.09 * SR); out[k:k + len(b)] += b[:len(out) - k]
    return out * 0.8 * vel


# ---------- mixing ----------
class Mix:
    def __init__(self, dur):
        self.n = int((dur + 4) * SR)
        self.dry = np.zeros((self.n, 2))
        self.wet = np.zeros((self.n, 2))  # send to reverb
        self.sidechain = np.ones(self.n)

    def add(self, sig, t, gain=1.0, pan=0.0, send=0.25):
        if sig.ndim == 1:
            sig = np.stack([sig * (1 - pan) * 0.7071 * 1.0, sig * (1 + pan) * 0.7071], 1)
        i = int(t * SR)
        if i >= self.n or i + len(sig) <= 0: return
        if i < 0: sig = sig[-i:]; i = 0
        j = min(self.n, i + len(sig))
        self.dry[i:j] += sig[:j - i] * gain
        self.wet[i:j] += sig[:j - i] * gain * send

    def duck(self, t, depth=0.45, release=0.28):
        i = int(t * SR); m = int(release * SR)
        if i >= self.n: return
        m = min(m, self.n - i)
        curve = 1 - depth * (1 - np.linspace(0, 1, m)) ** 2
        self.sidechain[i:i + m] = np.minimum(self.sidechain[i:i + m], curve)


def delay_ping(x, t_delay, fb=0.38, taps=4):
    out = x.copy()
    d = int(t_delay * SR)
    for k in range(1, taps + 1):
        g = fb ** k
        sh = np.zeros_like(x)
        sh[d * k:] = x[:-d * k] if d * k < len(x) else 0
        if k % 2: sh = sh[:, ::-1]
        out += sh * g
    return out


# ---------- arrangements ----------
PROGRESSIONS = {
    # warm, hopeful, "keynote" voicings (root, chord tones)
    'launch':  [('D2', ['D3', 'A3', 'E4', 'F#4', 'C#5']), ('B1', ['B2', 'F#3', 'D4', 'A4', 'E5']),
                ('G1', ['G2', 'D3', 'B3', 'F#4', 'C#5']), ('A1', ['A2', 'E3', 'B3', 'C#4', 'E5'])],
    'ai':      [('F2', ['F3', 'C4', 'G4', 'A4', 'E5']), ('D2', ['D3', 'A3', 'E4', 'F4', 'C5']),
                ('Bb1', ['Bb2', 'F3', 'C4', 'D4', 'A4']), ('C2', ['C3', 'G3', 'D4', 'E4', 'G4'])],
    'privacy': [('C2', ['C3', 'G3', 'E4', 'B4', 'D5']), ('A1', ['A2', 'E3', 'C4', 'G4', 'B4']),
                ('F1', ['F2', 'C3', 'A3', 'E4', 'G4']), ('G1', ['G2', 'D3', 'B3', 'D4', 'A4'])],
    'reel':    [('E2', ['E3', 'B3', 'G4', 'D5']), ('C2', ['C3', 'G3', 'E4', 'B4']),
                ('G1', ['G2', 'D3', 'B3', 'F#4']), ('D2', ['D3', 'A3', 'F#4', 'C#5'])],
}


def score(spec):
    dur = spec['duration']
    bpm = spec.get('bpm') or 96
    style = spec.get('music', 'launch')
    cues = sorted(spec.get('cues', []), key=lambda c: c['t'])
    beat = 60 / bpm
    bar = beat * 4
    mix = Mix(dur)
    prog = PROGRESSIONS.get(style, PROGRESSIONS['launch'])
    chord_bars = 2 if style == 'reel' else 2

    # Section levels over time (0 silence … 3 full)
    sections = [(c['t'], c.get('level', 1)) for c in cues if c['type'] == 'section'] or [(0, 1)]
    stop_t = next((c['t'] for c in cues if c['type'] == 'end'), dur)
    def level(t):
        lv = 0
        for st, l in sections:
            if t >= st: lv = l
        return lv if t < stop_t else -1

    # Harmony bed
    n_chords = int(np.ceil(stop_t / (bar * chord_bars))) + 1
    for k in range(n_chords):
        t = k * bar * chord_bars
        if t >= stop_t: break
        root, tones = prog[k % len(prog)]
        lv = level(t + 0.01)
        if lv < 0: continue
        length = bar * chord_bars + 1.8
        cut = {0: 2400, 1: 3200, 2: 4400, 3: 5600}[max(0, lv)]
        p = pad([hz(n) for n in tones], length, cutoff=cut, attack=1.2 if k else 2.5, release=1.8)
        mix.add(p, t, gain=0.62 if style != 'reel' else 0.4, send=0.5)
        if lv >= 1 or style == 'privacy':
            mix.add(sub(hz(root) * 2, bar * chord_bars), t, gain=0.2 if lv >= 2 else 0.12, send=0.02)

    # Rhythm and melody on the beat grid
    steps = int(stop_t / (beat / 4))
    arp_pattern = [0, 2, 3, 4, 1, 3, 2, 4]
    for s in range(steps):
        t = s * beat / 4
        lv = level(t)
        if lv < 0: break
        chord = prog[int(t // (bar * chord_bars)) % len(prog)][1]
        in_bar = s % 16
        if style == 'privacy':
            # sparse felt piano: chord tone every half bar, melody notes on top
            if in_bar in (0, 8) and lv >= 1:
                note = chord[(s // 8) % len(chord)]
                mix.add(piano(hz(note), 3.2, vel=0.8), t, gain=0.55, pan=-0.15, send=0.55)
            if in_bar == 12 and lv >= 2:
                mix.add(piano(hz(chord[-1]) * 2, 2.6, vel=0.55), t, gain=0.35, pan=0.25, send=0.6)
            continue
        if lv >= 1 and s % 2 == 0:
            note = chord[arp_pattern[(s // 2) % 8] % len(chord)]
            f = hz(note) * (2 if style in ('ai', 'reel') else 1)
            inst = bell(f, 1.2) * 0.9 if style == 'ai' else pluck(f, 1.4, bright=1.0 + 0.3 * lv)
            mix.add(inst, t, gain=0.36 if lv == 1 else 0.44, pan=0.35 * np.sin(s * 0.7), send=0.45)
            if s % 8 == 0:  # airy octave shimmer above the arpeggio
                mix.add(bell(f * 2, 1.6), t, gain=0.12, pan=-0.4 * np.sin(s * 0.3), send=0.7)
        if lv >= 2 and in_bar % 4 == 0:
            mix.add(kick(), t, gain=0.7 if style == 'reel' else 0.45, send=0.03)
            mix.duck(t, depth=0.5 if style == 'reel' else 0.35)
        if lv >= 2 and in_bar % 4 == 2:
            mix.add(hat(vel=1.0), t, gain=0.5, pan=0.2, send=0.05)
        if lv >= 3 and in_bar % 2 == 1:
            mix.add(hat(vel=0.55), t, gain=0.35, pan=-0.2, send=0.05)
        if lv >= 3 and in_bar in (4, 12):
            mix.add(clap(), t, gain=0.55, send=0.25)
        if style == 'reel' and lv >= 2 and in_bar in (10, 14):
            mix.add(kick(0.6), t, gain=0.5, send=0.02)

    # Sound design cues
    for c in cues:
        t, kind = c['t'], c['type']
        g = c.get('gain', 1.0)
        if kind == 'whoosh':
            d = c.get('dur', 0.9)
            mix.add(whoosh(d, rise=0.72, up=c.get('up', True)), t - d * 0.72, gain=0.7 * g, send=0.35)
        elif kind == 'riser':
            d = c.get('dur', 2.0)
            mix.add(riser(d), t - d, gain=0.55 * g, send=0.4)
        elif kind == 'impact':
            mix.add(impact(), t, gain=0.8 * g, send=0.5); mix.duck(t, 0.7, 0.9)
        elif kind == 'tick':
            mix.add(tick(f=c.get('f', 2400)), t, gain=0.8 * g, pan=c.get('pan', 0), send=0.2)
        elif kind == 'type':
            n = c.get('n', 12); d = c.get('dur', 1.0)
            for k in range(n):
                tt = t + d * k / n + rng.uniform(-0.012, 0.012)
                mix.add(keytap(rng.uniform(0.6, 1.0)), tt, gain=0.6 * g, pan=rng.uniform(-0.2, 0.2), send=0.1)
        elif kind == 'success':
            mix.add(success(), t, gain=0.7 * g, send=0.4)
        elif kind == 'chime':
            mix.add(bell(hz(c.get('note', 'A5')), 2.5), t, gain=0.5 * g, send=0.6)
        elif kind == 'end':
            # resolve on the tonic with a long tail
            root, tones = prog[0]
            mix.add(pad([hz(n) for n in tones], 6.0, cutoff=3200, attack=0.05, release=4.5), t, gain=0.85, send=0.8)
            mix.add(sub(hz(root) * 2, 4.0), t, gain=0.2, send=0.05)
            if style != 'privacy':
                mix.add(impact(0.7), t, gain=0.5, send=0.6)
            mix.add(bell(hz(tones[-1]), 4.0), t + 0.02, gain=0.6, send=0.7)

    # Effects & master
    music_wet = convolve(mix.wet, reverb_ir(3.2 if style in ('privacy', 'ai') else 2.4))
    out = mix.dry * mix.sidechain[:, None] + music_wet * 0.55
    out = delay_ping(out, beat * 0.75, fb=0.18, taps=3) * 0.85 + out * 0.15
    # gentle master EQ: trim mud, a touch of air
    for c in range(2):
        x = out[:, c]
        x = fft_filter(x, lo=30, slope=2)                       # rumble
        x = x - 0.55 * fft_filter(x, hi=110, slope=1.5)         # tame sub build-up
        x = x - 0.2 * fft_filter(x, lo=200, hi=450, slope=1)    # mud
        x = x + 0.35 * fft_filter(x, lo=2200, hi=6500, slope=1) # presence
        out[:, c] = x + 0.25 * fft_filter(x, lo=9000, slope=1)  # air
    # fade in/out and trim to film length
    n = int(dur * SR)
    out = out[:n]
    fade = int(0.04 * SR); out[:fade] *= np.linspace(0, 1, fade)[:, None]
    tail = int(min(2.5, dur * 0.1) * SR); out[-tail:] *= (np.linspace(1, 0, tail) ** 1.5)[:, None]
    peak = np.max(np.abs(out)) or 1
    out = np.tanh(out / peak * 1.4) / np.tanh(1.4) * 0.89
    return out


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    spec = json.load(open(sys.argv[1]))
    write_wav(sys.argv[2], score(spec))
    print('score →', sys.argv[2])
