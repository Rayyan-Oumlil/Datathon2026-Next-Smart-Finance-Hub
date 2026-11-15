import { describe, expect, it } from 'vitest';
import { pcmBytes, toPcm16 } from '@/lib/voice/pcm';

describe('toPcm16', () => {
    it('converts float samples to 16-bit and clips out-of-range values', () => {
        const out = toPcm16(Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]), 16000);
        expect([...out]).toEqual([0, 16384, -16384, 32767, -32768, 32767, -32768]);
    });

    it('keeps the length when the rate already matches', () => {
        expect(toPcm16(new Float32Array(160), 16000).length).toBe(160);
    });

    it('downsamples 48 kHz to 16 kHz by a factor of three', () => {
        const out = toPcm16(new Float32Array(4800).fill(0.25), 48000);
        expect(out.length).toBe(1600);
        expect(out.every((sample) => sample === 8192)).toBe(true);
    });

    it('averages the samples that collapse into one', () => {
        const out = toPcm16(Float32Array.from([0, 0.3, 0.6, 0.3, 0.6, 0.9]), 48000);
        expect(out.length).toBe(2);
        expect(out[0]).toBe(Math.round(0.3 * 32767));
        expect(out[1]).toBe(Math.round(0.6 * 32767));
    });

    it('refuses an input rate below the target', () => {
        expect(() => toPcm16(new Float32Array(10), 8000)).toThrow(/rate/i);
    });
});

describe('pcmBytes', () => {
    it('lays samples out little-endian', () => {
        expect([...pcmBytes(Int16Array.from([1, -2, 256]))]).toEqual([1, 0, 254, 255, 0, 1]);
    });
});
