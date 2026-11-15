'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechState = 'idle' | 'loading' | 'playing';

const MUTE_KEY = 'agent-speech-muted';
const FAILURE_VISIBLE_MS = 7000;

const readMuted = (): boolean => {
    try { return window.localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
};
const writeMuted = (muted: boolean) => {
    try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* the choice lasts until the page closes */ }
};

/**
 * Reads agent replies aloud: the text goes to /api/voice/speak (Amazon Polly) and the MP3 plays here. One reply at a
 * time; a new one, stop() or leaving the page cuts the old one off. The mute choice is remembered in this browser.
 */
export function useSpeech() {
    const [state, setState] = useState<SpeechState>('idle');
    const [failed, setFailed] = useState(false);
    const [muted, setMuted] = useState(false);

    const run = useRef(0);
    const request = useRef<AbortController | null>(null);
    const player = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
    const failTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => { setMuted(readMuted()); }, []);

    const release = useCallback(() => {
        request.current?.abort();
        request.current = null;
        if (player.current) {
            player.current.audio.pause();
            player.current.audio.removeAttribute('src');
            URL.revokeObjectURL(player.current.url);
            player.current = null;
        }
    }, []);

    const stop = useCallback(() => {
        run.current += 1;
        release();
        setState('idle');
    }, [release]);

    const fail = useCallback(() => {
        run.current += 1;
        release();
        setState('idle');
        setFailed(true);
        clearTimeout(failTimer.current);
        failTimer.current = setTimeout(() => setFailed(false), FAILURE_VISIBLE_MS);
    }, [release]);

    const speak = useCallback(async (text: string) => {
        stop();
        setFailed(false);
        const mine = ++run.current;
        const controller = new AbortController();
        request.current = controller;
        setState('loading');
        try {
            const response = await fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: controller.signal });
            if (mine !== run.current) return;
            if (response.status === 204) { setState('idle'); return; }
            if (!response.ok) throw new Error(`speak request failed (${response.status})`);
            const blob = await response.blob();
            if (mine !== run.current) return;

            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            player.current = { audio, url };
            audio.onended = () => { if (mine === run.current) stop(); };
            audio.onerror = () => { if (mine === run.current) fail(); };
            await audio.play();
            if (mine === run.current) setState('playing');
        } catch (error) {
            if (mine !== run.current || (error instanceof DOMException && error.name === 'AbortError')) return;
            fail();
        }
    }, [fail, stop]);

    const toggleMuted = useCallback(() => {
        const next = !muted;
        setMuted(next);
        writeMuted(next);
        if (next) stop();
    }, [muted, stop]);

    useEffect(() => () => { clearTimeout(failTimer.current); run.current += 1; release(); }, [release]);

    return { state, speaking: state !== 'idle', failed, muted, speak, stop, toggleMuted };
}
