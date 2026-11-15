// What of an agent reply is worth reading aloud: the answer itself, without the source line, file paths and
// markdown marks, and short enough to listen to.

export const SPEAK_MAX_CHARS = 1500;

const SOURCE_LINE = /^\s*(?:[-*•]\s*)?sources?\s*:.*$/gim;
const FILE_PATH = /\(?\b[\w.-]+(?:\/[\w.-]+)+\.\w+\b\)?/g;
const BULLET = /^\s*[-*•]\s+/gm;

export function speakable(text: string, max: number = SPEAK_MAX_CHARS): string {
    const cleaned = text
        .replace(SOURCE_LINE, '')
        .replace(FILE_PATH, '')
        .replace(BULLET, '')
        .replace(/[*_`#]+/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/ +([.,;:!?])/g, '$1')
        .replace(/\n{2,}/g, '\n')
        .trim();
    if (cleaned.length <= max) return cleaned;

    // Cut at the last full sentence that fits; failing that, at the last word
    const head = cleaned.slice(0, max);
    const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('\n'));
    if (sentence > max * 0.5) return head.slice(0, sentence + 1).trim();
    const word = head.lastIndexOf(' ');
    return (word > 0 ? head.slice(0, word) : head).trim();
}
