// Runs on the audio thread: hands each block of microphone samples to the page (hooks/useVoiceInput.ts).
class VoiceCapture extends AudioWorkletProcessor {
    process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (channel) this.port.postMessage(channel.slice(0));
        return true;
    }
}
registerProcessor('voice-capture', VoiceCapture);
