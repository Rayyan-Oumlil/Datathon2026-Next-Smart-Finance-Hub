'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Locale } from '@/i18n/config';

export type SpeechState = 'idle' | 'loading' | 'playing';

const MUTE_KEY = 'agent-speech-muted';
const FAILURE_VISIBLE_MS = 7000;
// A silent, empty WAV: played once inside a click to unlock the audio element (Safari and iOS only let an element
// that was started by a gesture play later, when the reply arrives)
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

const readMuted = (): boolean => {
    try { return window.localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
};
const writeMuted = (muted: boolean) => {
    try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* the choice lasts until the page closes */ }
};

/**
 * Reads agent replies aloud: the text goes to /api/voice/speak (Amazon Polly) and the MP3 plays here. One reply at a
 * time. stop() cuts off what is playing AND cancels any reply still on its way, so a reply is only read if nothing
 * was cancelled since it was asked for: take a ticket() when the question is sent and give it back to speak().
 * The mute choice is remembered in this browser.
 */
export function useSpeech() {
    const [state, setState] = useState<SpeechState>('idle');
    const [failed, setFailed] = useState(false);
    const [muted, setMuted] = useState(false);

    // Counts every start and every stop; a ticket is the value it had when the question was sent
    const run = useRef(0);
    const request = useRef<AbortController | null>(null);
    const element = useRef<HTMLAudioElement | null>(null);
    const objectUrl = useRef<string | null>(null);
    const mutedRef = useRef(false);
    const failTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        const stored = readMuted();
        mutedRef.current = stored;
        setMuted(stored);
    }, []);

    const release = useCallback(() => {
        request.current?.abort();
        request.current = null;
        const audio = element.current;
        if (audio) {
            audio.onended = null;
            audio.onerror = null;
            audio.pause();
            audio.removeAttribute('src');
        }
        if (objectUrl.current) {
            URL.revokeObjectURL(objectUrl.current);
            objectUrl.current = null;
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

    /** Call inside a click or key press: it unlocks the audio element so the reply can play when it arrives. */
    const prime = useCallback(() => {
        if (mutedRef.current) return;
        element.current ??= new Audio();
        const audio = element.current;
        if (audio.getAttribute('src')) return; // already in use
        audio.src = SILENCE;
        audio.play().then(
            () => { if (audio.src === SILENCE) { audio.pause(); audio.removeAttribute('src'); } },
            () => { if (audio.src === SILENCE) audio.removeAttribute('src'); },
        );
    }, []);

    /** What to give speak() later: the reply is read only if no stop() happened in between. */
    const ticket = useCallback(() => run.current, []);

    /** `language` is the reply's own; the voice follows it, whatever the app is set to. */
    const speak = useCallback(async (text: string, withTicket?: number, language?: Locale) => {
        if (withTicket !== undefined && withTicket !== run.current) return;
        stop();
        setFailed(false);
        const mine = ++run.current;
        const controller = new AbortController();
        request.current = controller;
        setState('loading');
        try {
            const response = await fetch('/api/voice/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...(language ? { language } : {}) }), signal: controller.signal });
            if (mine !== run.current) return;
            if (response.status === 204) { setState('idle'); return; }
            if (!response.ok) throw new Error(`speak request failed (${response.status})`);
            const blob = await response.blob();
            if (mine !== run.current) return;

            const url = URL.createObjectURL(blob);
            objectUrl.current = url;
            element.current ??= new Audio();
            const audio = element.current;
            audio.onended = () => { if (mine === run.current) stop(); };
            audio.onerror = () => { if (mine === run.current) fail(); };
            audio.src = url;
            await audio.play();
            if (mine === run.current) setState('playing');
        } catch (error) {
            if (mine !== run.current || (error instanceof DOMException && error.name === 'AbortError')) return;
            fail();
        }
    }, [fail, stop]);

    const toggleMuted = useCallback(() => {
        const next = !muted;
        mutedRef.current = next;
        setMuted(next);
        writeMuted(next);
        if (next) stop();
    }, [muted, stop]);

    useEffect(() => () => { clearTimeout(failTimer.current); run.current += 1; release(); }, [release]);

    return { state, speaking: state !== 'idle', failed, muted, speak, stop, ticket, prime, toggleMuted };
}
