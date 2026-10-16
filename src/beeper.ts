/**
 * The "rate this song" reminder sound. The beep is one looping audio buffer, so it keeps
 * time on the audio clock and isn't slowed down when the tab is in the background.
 */
let ctx: AudioContext | null = null;
const loops = new Set<AudioBufferSourceNode>();

/** Browsers only allow sound after a click or key press, so call this from one. */
export function primeBeeper(): void {
    try {
        ctx ??= new AudioContext();
        if (ctx.state === 'suspended') void ctx.resume();
    } catch { /* no audio available */ }
}

/** 2.5 seconds of audio: a short rising two-note chirp, then silence. */
function chirp(c: AudioContext): AudioBuffer {
    const sr = c.sampleRate;
    const buf = c.createBuffer(1, Math.round(sr * 2.5), sr);
    const data = buf.getChannelData(0);
    const tone = (start: number, secs: number, freq: number) => {
        const s0 = Math.round(start * sr);
        const n = Math.round(secs * sr);
        for (let i = 0; i < n; i++) {
            const fade = Math.min(1, i / (0.005 * sr), (n - i) / (0.03 * sr)); // avoid clicks
            data[s0 + i] += 0.25 * fade * Math.sin((2 * Math.PI * freq * i) / sr);
        }
    };
    tone(0, 0.12, 880);
    tone(0.16, 0.12, 1175);
    return buf;
}

function startBeeping(): void {
    primeBeeper();
    if (!ctx || loops.size) return;
    const src = ctx.createBufferSource();
    src.buffer = chirp(ctx);
    src.loop = true;
    src.connect(ctx.destination);
    src.start();
    loops.add(src);
}

/** Beeps while `on`. Safe to call repeatedly; the player calls it on every redraw. */
export function setBeeping(on: boolean): void {
    if (on) startBeeping();
    else stopBeeping();
}

/** Stops every beep, whatever state the app thinks it's in. */
function stopBeeping(): void {
    for (const src of loops) {
        try { src.stop(); } catch { /* already stopped */ }
        src.disconnect();
    }
    loops.clear();
}
