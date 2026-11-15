// Microphone audio arrives as floats at the device's rate (often 48 kHz); Transcribe wants 16-bit PCM at a fixed rate.

export const TARGET_RATE = 16000;

/** Floats in -1..1 to 16-bit samples at the target rate. Each output sample averages the input samples it covers. */
export function toPcm16(input: Float32Array, inputRate: number, outputRate: number = TARGET_RATE): Int16Array {
    if (inputRate < outputRate) throw new Error(`Input rate ${inputRate} Hz is below the ${outputRate} Hz Transcribe needs`);
    const ratio = inputRate / outputRate;
    const length = Math.floor(input.length / ratio);
    const out = new Int16Array(length);
    for (let i = 0; i < length; i++) {
        const from = Math.round(i * ratio);
        const to = Math.min(input.length, Math.max(from + 1, Math.round((i + 1) * ratio)));
        let sum = 0;
        for (let j = from; j < to; j++) sum += input[j];
        const sample = Math.max(-1, Math.min(1, sum / (to - from)));
        out[i] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
    }
    return out;
}

/** The samples as little-endian bytes, the layout of the stream. */
export function pcmBytes(samples: Int16Array): Uint8Array {
    const out = new Uint8Array(samples.length * 2);
    const view = new DataView(out.buffer);
    samples.forEach((sample, i) => view.setInt16(i * 2, sample, true));
    return out;
}
