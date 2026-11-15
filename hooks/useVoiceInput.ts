'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pcmBytes, toPcm16, TARGET_RATE } from '@/lib/voice/pcm';
import { startSession, type Session } from '@/lib/voice/session';

export type VoiceState = 'idle' | 'starting' | 'listening' | 'processing';
export type VoiceError = 'denied' | 'no-speech' | 'unavailable' | 'failed';
export type VoiceSupport = 'checking' | 'yes' | 'no-browser' | 'insecure';

type Options = {
    /** The hold-to-talk key works only while this is true (the panel is open). */
    enabled: boolean;
    /** The text so far, while the person is still talking. */
    onText: (text: string) => void;
    /** The finished text, once the person stops. */
    onFinal: (text: string) => void;
    /** Called when a dictation begins, before any text. */
    onStart?: () => void;
};

type Capture = { stream: MediaStream; context: AudioContext; node: AudioWorkletNode; source: MediaStreamAudioSourceNode; mute: GainNode };

const TOKEN_FAILED = 'token request failed';
const ERROR_VISIBLE_MS = 7000;

const fetchUrl = async (): Promise<string> => {
    const response = await fetch('/api/voice/token', { method: 'POST' });
    if (!response.ok) throw new Error(TOKEN_FAILED);
    const body: { url?: string } = await response.json();
    if (!body.url) throw new Error(TOKEN_FAILED);
    return body.url;
};

const release = (capture: Capture | null) => {
    if (!capture) return;
    capture.node.port.onmessage = null;
    capture.source.disconnect();
    capture.node.disconnect();
    capture.mute.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close().catch(() => undefined);
};

const getStream = () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });

// Ask for the rate Transcribe wants. Some browsers (Firefox) cannot connect a microphone to a context at a different
// rate; they get the device's own and toPcm16 converts.
const openContext = async (stream: MediaStream): Promise<{ context: AudioContext; source: MediaStreamAudioSourceNode }> => {
    for (const options of [{ sampleRate: TARGET_RATE }, undefined]) {
        const context = new AudioContext(options);
        try {
            const source = context.createMediaStreamSource(stream);
            await context.resume();
            return { context, source };
        } catch (error) {
            void context.close().catch(() => undefined);
            if (!options) throw error;
        }
    }
    throw new Error('No audio context');
};

const connectCapture = async (stream: MediaStream, onSamples: (pcm: Uint8Array) => void): Promise<Capture> => {
    try {
        const { context, source } = await openContext(stream);
        if (context.sampleRate < TARGET_RATE) throw new Error(`Audio rate ${context.sampleRate} Hz is too low`);
        await context.audioWorklet.addModule('/voice-worklet.js');
        const node = new AudioWorkletNode(context, 'voice-capture');
        const mute = context.createGain();
        mute.gain.value = 0;
        node.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(pcmBytes(toPcm16(event.data, context.sampleRate)));
        // Routed to a muted output so the browser keeps pulling audio through the worklet
        source.connect(node);
        node.connect(mute);
        mute.connect(context.destination);
        return { stream, context, node, source, mute };
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw error;
    }
};

const detect = (): VoiceSupport => {
    if (!window.isSecureContext) return 'insecure';
    const ok = !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && typeof WebSocket !== 'undefined';
    return ok ? 'yes' : 'no-browser';
};

/**
 * Dictation through Amazon Transcribe streaming: microphone audio goes straight to the service over a WebSocket
 * (the URL comes from /api/voice/token, so no credentials reach the browser) and the text comes back as it is said.
 * Hold Alt+V to talk, or tap start and stop; the finished text goes to onFinal.
 */
export function useVoiceInput({ enabled, onText, onFinal, onStart }: Options) {
    const [state, setState] = useState<VoiceState>('idle');
    const [error, setError] = useState<VoiceError | null>(null);
    const [support, setSupport] = useState<VoiceSupport>('checking');

    // The newest callbacks, so a long dictation never calls a stale closure
    const callbacks = useRef({ onText, onFinal, onStart });
    callbacks.current = { onText, onFinal, onStart };

    const stateRef = useRef<VoiceState>('idle');
    const run = useRef(0);
    const session = useRef<Session | null>(null);
    const capture = useRef<Capture | null>(null);
    const stopWanted = useRef(false);
    const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const move = useCallback((next: VoiceState) => { stateRef.current = next; setState(next); }, []);
    const teardown = useCallback(() => {
        release(capture.current);
        capture.current = null;
        session.current?.abort();
        session.current = null;
    }, []);
    const fail = useCallback((kind: VoiceError) => {
        run.current += 1;
        teardown();
        stopWanted.current = false;
        move('idle');
        setError(kind);
        clearTimeout(errorTimer.current);
        errorTimer.current = setTimeout(() => setError(null), ERROR_VISIBLE_MS);
    }, [move, teardown]);

    useEffect(() => { setSupport(detect()); }, []);

    const stop = useCallback(() => {
        if (stateRef.current === 'starting') { stopWanted.current = true; return; }
        if (stateRef.current !== 'listening') return;
        const mine = run.current;
        const current = session.current;
        release(capture.current);
        capture.current = null;
        move('processing');
        current?.finish().then((text) => {
            if (mine !== run.current) return;
            current?.abort();
            session.current = null;
            move('idle');
            const heard = text.trim();
            if (heard) callbacks.current.onFinal(heard); else fail('no-speech');
        }, () => { if (mine === run.current) fail('failed'); });
    }, [fail, move]);

    const start = useCallback(async () => {
        if (stateRef.current !== 'idle' || support !== 'yes') return;
        clearTimeout(errorTimer.current);
        setError(null);
        stopWanted.current = false;
        const mine = ++run.current;
        move('starting');
        callbacks.current.onStart?.();

        // The microphone first: a first-time permission prompt can take a while, and Transcribe closes a stream that
        // hears nothing for 15 seconds, so the connection must not be waiting while the person reads the prompt
        try {
            const stream = await getStream();
            if (mine !== run.current) { stream.getTracks().forEach((track) => track.stop()); return; }
            const current = startSession({
                getUrl: fetchUrl,
                createSocket: (url) => new WebSocket(url),
                onText: (text) => { if (mine === run.current) callbacks.current.onText(text); },
                onError: (cause) => { if (mine === run.current) fail(cause.message === TOKEN_FAILED ? 'unavailable' : 'failed'); },
            });
            session.current = current;
            const opened = await connectCapture(stream, (pcm) => current.push(pcm));
            if (mine !== run.current) { release(opened); return; }
            capture.current = opened;
        } catch (cause) {
            if (mine === run.current) fail(cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError') ? 'denied' : 'failed');
            return;
        }
        move('listening');
        if (stopWanted.current) stop();
    }, [fail, move, stop, support]);

    const cancel = useCallback(() => {
        if (stateRef.current === 'idle') return;
        run.current += 1;
        teardown();
        stopWanted.current = false;
        move('idle');
    }, [move, teardown]);

    // Hold Alt+V to talk, release to send. Key repeat is ignored, and losing focus counts as a release.
    useEffect(() => {
        if (!enabled || support !== 'yes') return;
        let held = false;
        const release = () => { if (held) { held = false; stop(); } };
        const down = (event: KeyboardEvent) => {
            if (event.code !== 'KeyV' || !event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            if (event.repeat || held) return;
            held = true;
            void start();
        };
        const up = (event: KeyboardEvent) => { if (event.code === 'KeyV' || event.key === 'Alt') release(); };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', release);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', release);
        };
    }, [enabled, support, start, stop]);

    // Closing the panel or leaving the page drops the dictation and frees the microphone
    useEffect(() => { if (!enabled) cancel(); }, [enabled, cancel]);
    useEffect(() => () => { clearTimeout(errorTimer.current); run.current += 1; teardown(); }, [teardown]);

    return { state, error, support, active: state !== 'idle', start, stop, cancel };
}
