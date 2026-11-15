'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVoiceEnabled } from '@/lib/voice/enabled';
import type { SpeechState } from '@/hooks/useSpeech';
import type { VoiceError, VoiceState, VoiceSupport } from '@/hooks/useVoiceInput';

type VoiceButtonProps = { state: VoiceState; support: VoiceSupport; onStart: () => void; onStop: () => void };

// The microphone next to Send: tap to start, tap again to send. Alt+V does the same while held.
// Not shown at all while the server's answer is pending or when the server does not offer voice (VOICE_ENABLED).
export const VoiceButton = ({ state, support, onStart, onStop }: VoiceButtonProps) => {
    const t = useTranslations('AgentPanel.voice');
    if (support === 'off' || support === 'checking') return null;
    const unavailable = support === 'no-browser' || support === 'insecure';
    const listening = state === 'starting' || state === 'listening';
    const label = unavailable ? t(support === 'insecure' ? 'insecure' : 'unsupported') : listening ? t('stop') : t('start');

    return (
        <button
            type="button"
            className={cn('btn relative h-11 px-3', listening ? 'btn-primary' : 'btn-ghost')}
            aria-label={label}
            aria-keyshortcuts="Alt+V"
            title={unavailable ? label : `${label} · ${t('hint')}`}
            disabled={unavailable}
            aria-disabled={state === 'processing' || undefined}
            onClick={state === 'processing' ? undefined : listening ? onStop : onStart}
        >
            {listening && <span aria-hidden className="absolute inset-0 rounded-[inherit] bg-brand/30 motion-safe:animate-ping" />}
            {state === 'processing' ? <Loader2 aria-hidden className="animate-spin" /> : unavailable ? <MicOff aria-hidden /> : <Mic aria-hidden />}
        </button>
    );
};

type SpeakerButtonProps = { state: SpeechState; muted: boolean; onToggleMuted: () => void; onStop: () => void };

// In the panel header: turns spoken replies on or off, and cuts a reply short while it is being read.
// Not shown at all unless the server offers voice (VOICE_ENABLED).
export const SpeakerButton = ({ state, muted, onToggleMuted, onStop }: SpeakerButtonProps) => {
    const t = useTranslations('AgentPanel.voice.speak');
    const enabled = useVoiceEnabled();
    if (enabled !== true) return null;
    const speaking = state !== 'idle';
    const label = speaking ? t('stop') : muted ? t('off') : t('on');
    return (
        <button
            type="button"
            className={cn('icon-btn', speaking && 'text-brand')}
            aria-label={label}
            title={`${label} · ${t('hint')}`}
            onClick={speaking ? onStop : onToggleMuted}
        >
            {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden className={cn(speaking && 'motion-safe:animate-pulse')} />}
        </button>
    );
};

type VoiceStatusProps = { state: VoiceState; error: VoiceError | null; speechFailed?: boolean };

const ERROR_KEYS: Record<VoiceError, 'denied' | 'noSpeech' | 'unavailable' | 'failed'> = {
    denied: 'denied',
    'no-speech': 'noSpeech',
    unavailable: 'unavailable',
    failed: 'failed',
};

// One quiet line above the input, only while something is happening or went wrong
export const VoiceStatus = ({ state, error, speechFailed }: VoiceStatusProps) => {
    const t = useTranslations('AgentPanel.voice');
    const failed = !!error || !!speechFailed;
    const text = error ? t(`errors.${ERROR_KEYS[error]}`)
        : state === 'starting' ? t('starting')
        : state === 'listening' ? t('listening')
        : state === 'processing' ? t('processing')
        : speechFailed ? t('errors.speech') : '';
    return (
        // Always rendered, so a screen reader announces the text when it appears
        <p role="status" aria-live="polite" className={cn('text-xs', text && 'mb-2', failed && state === 'idle' ? 'text-down' : 'text-faint')}>
            {text}
        </p>
    );
};
