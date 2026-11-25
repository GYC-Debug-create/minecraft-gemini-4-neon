import { EventBus, GameEventMap } from '../core/events';

export type SoundName =
  | 'dig'
  | 'break'
  | 'place'
  | 'step'
  | 'splash'
  | 'hit'
  | 'hurt'
  | 'bow'
  | 'eat'
  | 'pickup'
  | 'door'
  | 'craft'
  | 'ui';

/**
 * 100% procedural WebAudio SFX synthesizer (zero external audio files).
 * Safely degrades to a no-op in headless/restricted environments without throwing.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.7;
  private readonly lastPlayed = new Map<string, number>();
  private readonly unsubs: Array<() => void> = [];

  constructor(events?: EventBus<GameEventMap>) {
    if (events) {
      this.unsubs.push(
        events.on('sound:play', ({ name, volume, pitch }) => {
          this.play(name as SoundName, volume ?? 1.0, pitch ?? 1.0);
        }),
        events.on('player:damaged', () => {
          this.play('hurt', 0.9, 0.95 + Math.random() * 0.1);
        })
      );
    }
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      return this.ctx;
    } catch {
      this.ctx = null;
      return null;
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.6));
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  play(name: SoundName | string, vol = 1.0, pitch = 1.0): void {
    if (this.volume <= 0.001 || vol <= 0.001) return;
    const nowMs = performance.now();
    const minGap = name === 'dig' ? 110 : name === 'step' ? 240 : 35;
    const prev = this.lastPlayed.get(name) ?? 0;
    if (nowMs - prev < minGap) return;
    this.lastPlayed.set(name, nowMs);

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || ctx.state !== 'running') return;

    const t = ctx.currentTime;
    const gainScale = Math.max(0.01, Math.min(1.5, vol));
    const p = Math.max(0.4, Math.min(2.2, pitch * (0.94 + Math.random() * 0.12)));

    try {
      switch (name) {
        case 'dig':
          this.playNoiseBurst(ctx, t, 0.06, 900 * p, 'bandpass', 0.16 * gainScale);
          this.playTone(ctx, t, 'triangle', 170 * p, 95 * p, 0.05, 0.14 * gainScale);
          break;
        case 'break':
          this.playNoiseBurst(ctx, t, 0.14, 720 * p, 'bandpass', 0.34 * gainScale);
          this.playTone(ctx, t, 'triangle', 190 * p, 70 * p, 0.11, 0.28 * gainScale);
          break;
        case 'place':
          this.playTone(ctx, t, 'sine', 155 * p, 92 * p, 0.08, 0.30 * gainScale);
          this.playNoiseBurst(ctx, t, 0.05, 620 * p, 'lowpass', 0.14 * gainScale);
          break;
        case 'step':
          this.playNoiseBurst(ctx, t, 0.055, 520 * p, 'lowpass', 0.11 * gainScale);
          break;
        case 'splash':
          this.playNoiseBurst(ctx, t, 0.24, 1450 * p, 'bandpass', 0.28 * gainScale, 380 * p);
          this.playTone(ctx, t + 0.03, 'sine', 420 * p, 240 * p, 0.12, 0.12 * gainScale);
          break;
        case 'hit':
          this.playTone(ctx, t, 'sawtooth', 240 * p, 85 * p, 0.09, 0.24 * gainScale);
          this.playNoiseBurst(ctx, t, 0.07, 1500 * p, 'highpass', 0.18 * gainScale);
          break;
        case 'hurt':
          this.playTone(ctx, t, 'sawtooth', 165 * p, 72 * p, 0.16, 0.28 * gainScale);
          this.playNoiseBurst(ctx, t, 0.09, 450, 'lowpass', 0.16 * gainScale);
          break;
        case 'bow':
          this.playTone(ctx, t, 'triangle', 520 * p, 180 * p, 0.14, 0.24 * gainScale);
          this.playNoiseBurst(ctx, t, 0.11, 2200 * p, 'bandpass', 0.12 * gainScale);
          break;
        case 'eat':
          this.playNoiseBurst(ctx, t, 0.06, 1100 * p, 'bandpass', 0.2 * gainScale);
          this.playNoiseBurst(ctx, t + 0.09, 0.06, 1300 * p, 'bandpass', 0.18 * gainScale);
          break;
        case 'pickup':
          this.playTone(ctx, t, 'sine', 587 * p, 880 * p, 0.09, 0.14 * gainScale);
          break;
        case 'door':
          this.playTone(ctx, t, 'square', 210 * p, 140 * p, 0.08, 0.12 * gainScale);
          break;
        case 'craft':
          this.playTone(ctx, t, 'triangle', 440 * p, 660 * p, 0.1, 0.16 * gainScale);
          this.playTone(ctx, t + 0.05, 'sine', 660 * p, 880 * p, 0.12, 0.12 * gainScale);
          break;
        case 'ui':
        default:
          this.playTone(ctx, t, 'triangle', 680 * p, 480 * p, 0.04, 0.12 * gainScale);
          break;
      }
    } catch {
      // Ignore synthesis edge errors in headless environments
    }
  }

  private playTone(
    ctx: AudioContext,
    startTime: number,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    duration: number,
    peakGain: number
  ): void {
    if (!this.masterGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, startFreq), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), startTime + duration);

    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  private playNoiseBurst(
    ctx: AudioContext,
    startTime: number,
    duration: number,
    freq: number,
    filterType: BiquadFilterType,
    peakGain: number,
    endFreq?: number
  ): void {
    if (!this.masterGain || !this.noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(80, freq), startTime);
    if (endFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, endFreq), startTime + duration);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(startTime, Math.random() * 0.2, duration + 0.02);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
