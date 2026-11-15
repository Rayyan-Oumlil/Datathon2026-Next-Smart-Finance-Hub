// What of an agent reply is worth reading aloud: the answer itself, without the source line, file paths, web addresses
// and markdown marks, and short enough to listen to.

export const SPEAK_MAX_CHARS = 1500;

const URL_ADDRESS = /https?:\/\/\S+/g;
// Only real files: a slash-joined path whose last part ends in a known file type. "VOO/VFV.TO" and "4.5/5.0" are not paths.
const FILE_PATH = /\(?\b(?:[\w.-]+\/)+[\w.-]+\.(?:md|json|csv|txt|ya?ml|tsx?|jsx?|py)\b\)?/gi;
// [ \t] and not \s: a line's own indent only, so the pattern never runs over a stretch of blank lines
const SOURCE_LINE = /^[ \t]*(?:[-*•][ \t]*)?sources?[ \t]*:.*$/gim;
const BULLET = /^[ \t]*[-*•][ \t]+/gm;
const HEADING = /^[ \t]*#{1,6}[ \t]+/gm;

export function speakable(text: string, max: number = SPEAK_MAX_CHARS): string {
    const cleaned = text
        .replace(URL_ADDRESS, '')
        // Emphasis marks come off first, so "**Source:**" and "_Source: x_" are still found as a source line
        .replace(/[*`]+/g, '')
        .replace(/(?<=\w)_(?=\w)/g, ' ')
        .replace(/_+/g, '')
        .replace(SOURCE_LINE, '')
        .replace(FILE_PATH, '')
        .replace(HEADING, '')
        .replace(BULLET, '')
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
