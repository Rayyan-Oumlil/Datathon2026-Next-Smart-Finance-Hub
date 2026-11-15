import { describe, expect, it } from 'vitest';
import { parseCsv, parseTable, ReplayDataError } from '@/lib/replay';

const fields = (text: string) => parseCsv(text, 't.csv').map((r) => r.fields);

describe('parseCsv', () => {
    it('splits plain records with LF and CRLF line ends', () => {
        expect(fields('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
        expect(fields('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
        expect(fields('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    });

    it('keeps commas, escaped quotes and line breaks inside quoted fields', () => {
        expect(fields('"Government of Canada, 10-year",x\n')).toEqual([['Government of Canada, 10-year', 'x']]);
        expect(fields('"say ""hi""",2\n')).toEqual([['say "hi"', '2']]);
        expect(fields('"two\nlines",b\r\nc,d\n')).toEqual([['two\nlines', 'b'], ['c', 'd']]);
        expect(fields('"crlf\r\ninside",b\n')).toEqual([['crlf\r\ninside', 'b']]);
    });

    it('keeps empty fields, including a trailing one and an empty quoted one', () => {
        expect(fields('a,,c\n')).toEqual([['a', '', 'c']]);
        expect(fields('a,b,\n')).toEqual([['a', 'b', '']]);
        expect(fields('"",x\n')).toEqual([['', 'x']]);
        expect(fields(',\n')).toEqual([['', '']]);
    });

    it('strips a UTF-8 BOM', () => {
        expect(fields('﻿a,b\n')).toEqual([['a', 'b']]);
    });

    it('reports the line each record starts on, counting line breaks inside quotes', () => {
        const recs = parseCsv('h\n"a\nb"\nc\n', 't.csv');
        expect(recs.map((r) => r.line)).toEqual([1, 2, 4]);
    });

    it('rejects malformed quoting with file and line', () => {
        expect(() => parseCsv('a\n"open', 'f.csv')).toThrow(/f\.csv:2: unterminated/);
        expect(() => parseCsv('a\nb"c\n', 'f.csv')).toThrow(/f\.csv:2: quote inside/);
        expect(() => parseCsv('a\n"b"c\n', 'f.csv')).toThrow(/f\.csv:2: unexpected character/);
        expect(() => parseCsv('a\rb\n', 'f.csv')).toThrow(ReplayDataError);
    });
});

describe('parseTable', () => {
    it('reads columns by name', () => {
        const rows = parseTable('x,y\n1,"2,5"\n', 't.csv', ['x', 'y']);
        expect(rows.map((r) => [r.get('x'), r.get('y')])).toEqual([['1', '2,5']]);
    });

    it('refuses an unexpected header or a short row, naming the line', () => {
        expect(() => parseTable('x,z\n1,2\n', 't.csv', ['x', 'y'])).toThrow(/t\.csv:1: unexpected header/);
        expect(() => parseTable('x,y\n1,2\n3\n', 't.csv', ['x', 'y'])).toThrow(/t\.csv:3: expected 2 fields, found 1/);
        expect(() => parseTable('x,y\n1,2\n\n', 't.csv', ['x', 'y'])).toThrow(/t\.csv:3/);
        expect(() => parseTable('', 't.csv', ['x'])).toThrow(/empty file/);
    });
});
