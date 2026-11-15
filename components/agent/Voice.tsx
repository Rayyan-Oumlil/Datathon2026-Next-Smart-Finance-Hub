'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VoiceError, VoiceState, VoiceSupport } from '@/hooks/useVoiceInput';

type VoiceButtonProps = { state: VoiceState; support: VoiceSupport; onStart: () => void; onStop: () => void };

// The microphone next to Send: tap to start, tap again to send. Alt+V does the same while held.
export const VoiceButton = ({ state, support, onStart, onStop }: VoiceButtonProps) => {
    const t = useTranslations('AgentPanel.voice');
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
            disabled={unavailable || support === 'checking'}
            aria-disabled={state === 'processing' || undefined}
            onClick={state === 'processing' ? undefined : listening ? onStop : onStart}
        >
            {listening && <span aria-hidden className="absolute inset-0 rounded-[inherit] bg-brand/30 motion-safe:animate-ping" />}
            {state === 'processing' ? <Loader2 aria-hidden className="animate-spin" /> : unavailable ? <MicOff aria-hidden /> : <Mic aria-hidden />}
        </button>
    );
};

type VoiceStatusProps = { state: VoiceState; error: VoiceError | null };

const ERROR_KEYS: Record<VoiceError, 'denied' | 'noSpeech' | 'unavailable' | 'failed'> = {
    denied: 'denied',
    'no-speech': 'noSpeech',
    unavailable: 'unavailable',
    failed: 'failed',
};

// One quiet line above the input, only while something is happening or went wrong
export const VoiceStatus = ({ state, error }: VoiceStatusProps) => {
    const t = useTranslations('AgentPanel.voice');
    const text = error ? t(`errors.${ERROR_KEYS[error]}`) : state === 'starting' ? t('starting') : state === 'listening' ? t('listening') : state === 'processing' ? t('processing') : '';
    return (
        // Always rendered, so a screen reader announces the text when it appears
        <p role="status" aria-live="polite" className={cn('text-xs', text && 'mb-2', error ? 'text-down' : 'text-faint')}>
            {text}
        </p>
    );
};
