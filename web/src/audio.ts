// Where's Codex — procedural Web Audio.
// No audio assets. Every sound is synthesized via oscillators + noise so the
// production bundle stays a few hundred bytes lighter and we sidestep codec
// portability headaches (Safari, iOS lockscreen, etc).
//
// Design pivot from Saigon Rush (the reference for procedural synthesis):
//   Saigon Rush is a frenzied arcade game — chiptune at 180 BPM throughout.
//   Where's Codex is a *social* deduction game — players need to read each
//   other talk. Constant music would drown the gameplay. So:
//     - lobby: low-key synth groove (sets tone, eases pre-game tension)
//     - rollin: countdown beeps
//     - active: SILENT room-tone (intentional — chat is the soundtrack)
//     - reveal: dramatic sting + fade
//   SFX are sparse and short throughout.

type AudioState = "idle" | "ready" | "blocked";

const MUTE_KEY = "wheres-codex-mute";

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private state: AudioState = "idle";
  private muted = false;
  private cleanupTimeouts = new Set<number>();
  private lobbyPlaying = false;
  private lobbyTimeouts: number[] = [];

  constructor() {
    try {
      this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      this.muted = false;
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────
  init(): boolean {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => undefined);
      return this.state === "ready";
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.state = "blocked";
        return false;
      }
      const ctx = new Ctor();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.32, ctx.currentTime + 0.08);
      master.connect(ctx.destination);
      const sfx = ctx.createGain();
      sfx.gain.value = 0.7;
      sfx.connect(master);
      const music = ctx.createGain();
      music.gain.value = 0.45;
      music.connect(master);
      this.master = master;
      this.sfxBus = sfx;
      this.musicBus = music;
      if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
      this.state = "ready";
      return true;
    } catch {
      this.state = "blocked";
      return false;
    }
  }

  isReady(): boolean {
    return this.state === "ready" && !!this.ctx && !!this.master;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(value: boolean): void {
    this.muted = value;
    try {
      window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(value ? 0 : 0.32, now + 0.18);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // ── Internal voicing helpers ─────────────────────────────────
  private trackCleanup(ms: number, fn: () => void): void {
    const tid = window.setTimeout(() => {
      this.cleanupTimeouts.delete(tid);
      fn();
    }, ms);
    this.cleanupTimeouts.add(tid);
  }

  private tone(freq: number, duration: number, type: OscillatorType = "triangle", vol = 0.12, attack = 0.005): void {
    if (!this.isReady() || !this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.005, vol), now + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, now + duration);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + duration + 0.05);
    osc.onended = () => {
      try { osc.disconnect(); g.disconnect(); } catch { /* swallow */ }
    };
    this.trackCleanup((duration + 0.2) * 1000, () => {
      try { osc.disconnect(); g.disconnect(); } catch { /* swallow */ }
    });
  }

  private noise(vol: number, duration: number, filterFreq?: number, type: BiquadFilterType = "lowpass"): void {
    if (!this.isReady() || !this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.005, vol), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    let filter: BiquadFilterNode | null = null;
    if (filterFreq) {
      filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = filterFreq;
      src.connect(filter);
      filter.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(this.sfxBus);
    src.start(now);
    src.stop(now + duration + 0.02);
    src.onended = () => {
      try { src.disconnect(); g.disconnect(); filter?.disconnect(); } catch { /* swallow */ }
    };
    this.trackCleanup((duration + 0.2) * 1000, () => {
      try { src.disconnect(); g.disconnect(); filter?.disconnect(); } catch { /* swallow */ }
    });
  }

  // ── SFX ─────────────────────────────────────────────────────

  /** First-tap on vote tile — light tick. */
  voteTap(): void {
    this.tone(640, 0.05, "square", 0.07);
  }

  /** Confirm-tap on vote tile — descending pair, "committed". */
  voteCast(): void {
    this.tone(880, 0.08, "square", 0.10);
    setTimeout(() => this.tone(660, 0.10, "triangle", 0.09), 60);
  }

  /** Incoming chat message from any other player. */
  chatPing(): void {
    this.tone(1100, 0.04, "sine", 0.05);
  }

  /** Outgoing chat (own send) — slightly lower-pitched echo. */
  chatSend(): void {
    this.tone(820, 0.05, "sine", 0.05);
  }

  /** Own player tapped to move — tiny footstep tick. */
  step(): void {
    this.noise(0.04, 0.03, 1800, "highpass");
  }

  /** Own player has been ghosted — descending fail. */
  ghost(): void {
    if (!this.isReady() || !this.ctx || !this.sfxBus) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.55);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.13, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(g);
    g.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.65);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* swallow */ } };
    this.trackCleanup(800, () => { try { osc.disconnect(); g.disconnect(); } catch { /* swallow */ } });
    this.noise(0.05, 0.4, 800, "lowpass");
  }

  /** Phase enters rollin — countdown 3-2-1-go beeps. */
  countdown(num: number): void {
    if (num >= 3) this.tone(440, 0.10, "square", 0.10);
    else if (num === 2) this.tone(554, 0.10, "square", 0.10);
    else if (num === 1) this.tone(659, 0.10, "square", 0.10);
    else {
      this.tone(880, 0.18, "square", 0.11);
      this.tone(1320, 0.18, "triangle", 0.07);
    }
  }

  /** Reveal phase — dramatic synth swell + low boom. */
  reveal(): void {
    if (!this.isReady() || !this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // Rising sweep — tension into release
    const sweep = ctx.createOscillator();
    sweep.type = "sawtooth";
    sweep.frequency.setValueAtTime(180, now);
    sweep.frequency.exponentialRampToValueAtTime(660, now + 0.9);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(0.13, now + 0.5);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 1.1);
    sweep.connect(sg);
    sg.connect(this.sfxBus);
    sweep.start(now);
    sweep.stop(now + 1.15);
    sweep.onended = () => { try { sweep.disconnect(); sg.disconnect(); } catch { /* swallow */ } };
    this.trackCleanup(1300, () => { try { sweep.disconnect(); sg.disconnect(); } catch { /* swallow */ } });
    // Low boom on impact
    setTimeout(() => {
      this.tone(110, 0.7, "sine", 0.18, 0.01);
      this.tone(165, 0.6, "triangle", 0.10, 0.01);
      this.noise(0.08, 0.35, 240, "lowpass");
    }, 700);
  }

  /** Correct vote (the voter found Codex) — triumphant chord. */
  win(): void {
    this.tone(523, 0.30, "triangle", 0.10);
    setTimeout(() => this.tone(659, 0.30, "triangle", 0.10), 90);
    setTimeout(() => this.tone(784, 0.45, "triangle", 0.11), 180);
    setTimeout(() => this.tone(1046, 0.45, "sine", 0.07), 240);
  }

  /** Lobby ambient groove — Vietnamese-tinged minor pads, low BPM, sparse. */
  startLobbyMusic(): void {
    if (this.lobbyPlaying) return;
    if (!this.isReady()) return;
    this.lobbyPlaying = true;
    this.scheduleLobbyLoop();
  }

  stopLobbyMusic(fadeMs = 600): void {
    if (!this.lobbyPlaying) return;
    this.lobbyPlaying = false;
    for (const tid of this.lobbyTimeouts) clearTimeout(tid);
    this.lobbyTimeouts = [];
    if (this.musicBus && this.ctx) {
      const now = this.ctx.currentTime;
      const target = this.musicBus.gain.value;
      this.musicBus.gain.cancelScheduledValues(now);
      this.musicBus.gain.setValueAtTime(target, now);
      this.musicBus.gain.linearRampToValueAtTime(0.0001, now + fadeMs / 1000);
      // Restore for next time
      window.setTimeout(() => {
        if (this.musicBus && this.ctx) {
          this.musicBus.gain.setValueAtTime(0.45, this.ctx.currentTime);
        }
      }, fadeMs + 60);
    }
  }

  private scheduleLobbyLoop(): void {
    if (!this.lobbyPlaying || !this.isReady() || !this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const bpm = 88; // slow, suspenseful
    const beatMs = (60 / bpm) * 1000;
    const totalBeats = 32;

    // Minor mode (A-minor + flavours): A C E G  + hint of D
    const A2 = 110.0, E3 = 164.81, A3 = 220.0;
    const C4 = 261.63, D4 = 293.66, E4 = 329.63, G4 = 392.0, A4 = 440.0;
    const C5 = 523.25, E5 = 659.25;

    const pad = (beat: number, freq: number, dur: number, vol: number) => {
      const tid = window.setTimeout(() => {
        if (!this.lobbyPlaying) return;
        this.musicTone(freq, dur, "sine", vol, 0.12);
      }, beat * beatMs);
      this.lobbyTimeouts.push(tid);
    };
    const lead = (beat: number, freq: number, dur: number, vol: number) => {
      const tid = window.setTimeout(() => {
        if (!this.lobbyPlaying) return;
        this.musicTone(freq, dur, "triangle", vol, 0.04);
      }, beat * beatMs);
      this.lobbyTimeouts.push(tid);
    };
    const bass = (beat: number, freq: number, dur: number, vol: number) => {
      const tid = window.setTimeout(() => {
        if (!this.lobbyPlaying) return;
        this.musicTone(freq, dur, "triangle", vol, 0.02);
      }, beat * beatMs);
      this.lobbyTimeouts.push(tid);
    };

    // Sparse pad bed every 4 beats
    pad(0, A3, 1.6, 0.045);
    pad(4, E3, 1.6, 0.04);
    pad(8, C4, 1.6, 0.04);
    pad(12, E3, 1.6, 0.04);
    pad(16, A3, 1.6, 0.045);
    pad(20, G4, 1.4, 0.035);
    pad(24, D4, 1.6, 0.04);
    pad(28, E3, 1.6, 0.04);

    // Walking bass
    const bassLine: Array<[number, number]> = [
      [0, A2], [3.5, E3], [4, A2], [7.5, G4 / 2],
      [8, A2], [11.5, C4 / 1], [12, E3], [15.5, A2],
      [16, A2], [19.5, E3], [20, A2], [23.5, G4 / 2],
      [24, A2], [27.5, D4 / 1], [28, E3], [31.5, A2],
    ];
    for (const [b, f] of bassLine) bass(b, f, 0.6, 0.05);

    // Sparse melodic motif — leaves space for chat to breathe
    lead(2, E4, 0.4, 0.04);
    lead(2.75, G4, 0.4, 0.04);
    lead(6, A4, 0.5, 0.045);
    lead(10, C5, 0.6, 0.04);
    lead(10.75, E5, 0.4, 0.035);
    lead(14, G4, 0.6, 0.04);
    lead(18, E4, 0.4, 0.04);
    lead(22, A4, 0.6, 0.045);
    lead(26, G4, 0.5, 0.04);
    lead(30, A4, 0.8, 0.04);

    // Loop
    const loopTid = window.setTimeout(() => this.scheduleLobbyLoop(), totalBeats * beatMs);
    this.lobbyTimeouts.push(loopTid);

    void ctx; // kept for future direct scheduling
  }

  private musicTone(freq: number, duration: number, type: OscillatorType, vol: number, attack: number): void {
    if (!this.isReady() || !this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.005, vol), now + attack);
    g.gain.setValueAtTime(Math.max(0.005, vol), now + duration * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0005, now + duration);
    osc.connect(g);
    g.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + duration + 0.04);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch { /* swallow */ } };
    this.trackCleanup((duration + 0.2) * 1000, () => {
      try { osc.disconnect(); g.disconnect(); } catch { /* swallow */ }
    });
  }

  destroy(): void {
    this.stopLobbyMusic(50);
    for (const tid of this.cleanupTimeouts) clearTimeout(tid);
    this.cleanupTimeouts.clear();
    this.sfxBus?.disconnect();
    this.musicBus?.disconnect();
    this.master?.disconnect();
    this.sfxBus = null;
    this.musicBus = null;
    this.master = null;
    if (this.ctx) {
      this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.state = "idle";
  }
}

export const audio = new AudioBus();
