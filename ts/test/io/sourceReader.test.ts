import { describe, expect, it } from 'vitest';
import { SourceReader, SourceReaderHost } from '../../src/io/SourceReader';

interface FakeHost extends SourceReaderHost {
  warnings: string[];
}

function makeHost(): FakeHost {
  const warnings: string[] = [];
  return {
    lineno: 0,
    infile: '',
    warnings,
    error(msg: string): never {
      throw new Error(msg);
    },
    warning(msg: string): void {
      warnings.push(msg);
    },
  };
}

const NL = '\n';
const BS = '\\';
const NBSP = String.fromCharCode(0xa0);

/** Join source lines and terminate with a newline. */
function line(...ls: string[]): string {
  return ls.join(NL) + NL;
}

function drain(r: SourceReader): string[][] {
  const out: string[][] = [];
  for (;;) {
    const l = r.read();
    if (l === null) break;
    out.push(l);
  }
  return out;
}

describe('SourceReader (port of MMA/file.py ReadFile)', () => {
  it('exposes fname and updates host.infile', () => {
    const host = makeHost();
    const r = new SourceReader(host, 'song.mma', 'PLAY C\n');
    expect(r.fname).toBe('song.mma');
    expect(host.infile).toBe('song.mma');
  });

  it('tokenizes on whitespace and drops blank lines', () => {
    const r = new SourceReader(
      makeHost(),
      't.mma',
      line('  PLAY   Cmajor  ', '', '   ', '\tPLAY\tDm'),
    );
    expect(drain(r)).toEqual([
      ['PLAY', 'Cmajor'],
      ['PLAY', 'Dm'],
    ]);
  });

  it('reports physical line numbers, counting blanks, comments and continuations', () => {
    const host = makeHost();
    const r = new SourceReader(
      host,
      't.mma',
      line('PLAY A', '', '// note', 'PLAY B', 'PLAY ' + BS, '  C', 'PLAY D'),
    );
    const linenos: number[] = [];
    for (;;) {
      const l = r.read();
      if (l === null) break;
      linenos.push(host.lineno);
    }
    expect(linenos).toEqual([1, 4, 6, 7]);
  });

  it('strips // comments and drops comment-only lines', () => {
    const r = new SourceReader(
      makeHost(),
      't.mma',
      line('PLAY C // trailing', '// whole line', '   // indented', 'PLAY D'),
    );
    expect(drain(r)).toEqual([
      ['PLAY', 'C'],
      ['PLAY', 'D'],
    ]);
  });

  it('strips /* */ comments, including several on one line', () => {
    const r = new SourceReader(makeHost(), 't.mma', line('PLAY /* one */ C /* two */ D'));
    expect(drain(r)).toEqual([['PLAY', 'C', 'D']]);
  });

  it('concatenates tokens around an inline block comment like Python', () => {
    const r = new SourceReader(makeHost(), 't.mma', line('PLAY a/*x*/b'));
    expect(drain(r)).toEqual([['PLAY', 'ab']]);
  });

  it('drops a line that is only a block comment', () => {
    const r = new SourceReader(makeHost(), 't.mma', line('/* nothing */', 'PLAY A'));
    expect(drain(r)).toEqual([['PLAY', 'A']]);
  });

  it('strips // before scanning for /* (Python order)', () => {
    const r = new SourceReader(
      makeHost(),
      't.mma',
      line('PLAY C // /* not a comment', 'PLAY D'),
    );
    expect(drain(r)).toEqual([
      ['PLAY', 'C'],
      ['PLAY', 'D'],
    ]);
  });

  it('opens a block comment with the text after // stripping', () => {
    const host = makeHost();
    const r = new SourceReader(
      host,
      't.mma',
      line('PLAY C /* start // trailing', 'PLAY D', '*/ PLAY E'),
    );
    expect(drain(r)).toEqual([
      ['PLAY', 'C'],
      ['PLAY', 'E'],
    ]);
    expect(host.lineno).toBe(3);
  });

  it('handles /* */ comments spanning multiple lines', () => {
    const host = makeHost();
    const r = new SourceReader(
      host,
      't.mma',
      line('PLAY A', '/* start', 'still comment', '*/ PLAY B', 'PLAY C'),
    );
    const lines = drain(r);
    expect(lines).toEqual([['PLAY', 'A'], ['PLAY', 'B'], ['PLAY', 'C']]);
    expect(host.lineno).toBe(5);
  });

  it('warns when /* is found inside a block comment', () => {
    const host = makeHost();
    const r = new SourceReader(host, 't.mma', line('/* start', '/* nested', '*/ X'));
    expect(drain(r)).toEqual([['X']]);
    expect(host.warnings).toEqual(["Block comment start '/*' found inside comment."]);
  });

  it('errors on an unterminated block comment', () => {
    expect(
      () => new SourceReader(makeHost(), 't.mma', line('PLAY A', '/* oops')),
    ).toThrow('Multiline comment (/* */) not terminated.');
  });

  it('joins continuation lines with a single space', () => {
    const host = makeHost();
    const r = new SourceReader(
      host,
      't.mma',
      line('PLAY ' + BS, '   Cmajor ' + BS, '  LOUD', 'PLAY D'),
    );
    const lines = drain(r);
    expect(lines).toEqual([
      ['PLAY', 'Cmajor', 'LOUD'],
      ['PLAY', 'D'],
    ]);
    expect(host.lineno).toBe(4);
  });

  it('handles a trailing backslash at end of input', () => {
    const host = makeHost();
    const r = new SourceReader(host, 't.mma', line('PLAY ' + BS));
    expect(r.read()).toEqual(['PLAY']);
    expect(host.lineno).toBe(2); // the virtual EOF read counts, like Python
    expect(r.read()).toBeNull();
  });

  it('converts NBSP 0xA0 to a regular space', () => {
    const r = new SourceReader(
      makeHost(),
      't.mma',
      line('PLAY' + NBSP + 'C', NBSP + 'PLAY' + NBSP + NBSP + 'D'),
    );
    expect(drain(r)).toEqual([
      ['PLAY', 'C'],
      ['PLAY', 'D'],
    ]);
  });

  it('recognizes LABEL definitions case-insensitively and returns the line verbatim', () => {
    const r = new SourceReader(makeHost(), 't.mma', line('label Chorus', 'PLAY A'));
    // Python stores the source tokens unchanged; only the label is uppercased.
    expect(r.read()).toEqual(['label', 'Chorus']);
    r.goto('CHORUS');
    expect(r.read()).toEqual(['label', 'Chorus']);
    expect(r.read()).toEqual(['PLAY', 'A']);
  });

  it('goto jumps so the label line itself is read next', () => {
    const host = makeHost();
    const r = new SourceReader(host, 't.mma', line('PLAY A', 'LABEL X', 'PLAY B'));
    expect(r.read()).toEqual(['PLAY', 'A']);
    r.goto('X');
    expect(r.read()).toEqual(['LABEL', 'X']);
    expect(host.lineno).toBe(2);
    expect(r.read()).toEqual(['PLAY', 'B']);
  });

  it('errors on malformed LABEL usage and sets host.lineno', () => {
    expect(() => new SourceReader(makeHost(), 't.mma', line('LABEL'))).toThrow(
      'Usage: LABEL <string>',
    );
    const host = makeHost();
    expect(
      () => new SourceReader(host, 't.mma', line('PLAY A', 'LABEL A B')),
    ).toThrow('Usage: LABEL <string>');
    expect(host.lineno).toBe(2);
  });

  it('rejects variable labels', () => {
    const host = makeHost();
    expect(
      () => new SourceReader(host, 't.mma', line('PLAY A', 'LABEL $FOO')),
    ).toThrow('Variables are not permitted as labels');
    expect(host.lineno).toBe(2);
  });

  it('errors on duplicate LABELs with the offending line number', () => {
    const host = makeHost();
    expect(
      () => new SourceReader(host, 't.mma', line('LABEL A', 'PLAY C', 'LABEL A')),
    ).toThrow('Duplicate label specified in line 3');
    expect(host.lineno).toBe(3);
  });

  it('cross-checks LABEL and numeric label names', () => {
    expect(() => new SourceReader(makeHost(), 't.mma', line('LABEL 10', '10'))).toThrow(
      "Line number '10' duplicates LABEL",
    );
    expect(() => new SourceReader(makeHost(), 't.mma', line('10', 'LABEL 10'))).toThrow(
      "Label '10' duplicates line number label",
    );
  });

  it('numeric labels: the last duplicate wins for goto', () => {
    const text = line('10', 'PLAY A', '20', 'PLAY B', '10', 'PLAY C');
    expect(drain(new SourceReader(makeHost(), 't.mma', text))).toEqual([
      ['10'],
      ['PLAY', 'A'],
      ['20'],
      ['PLAY', 'B'],
      ['10'],
      ['PLAY', 'C'],
    ]);

    const r = new SourceReader(makeHost(), 't.mma', text);
    r.goto('10');
    expect(r.read()).toEqual(['10']);
    expect(r.read()).toEqual(['PLAY', 'C']);
  });

  it('goto errors on unknown and empty labels', () => {
    const r = new SourceReader(makeHost(), 't.mma', line('PLAY A'));
    expect(() => r.goto('MISSING')).toThrow("Label 'MISSING' has not been set");
    expect(() => r.goto('')).toThrow('No label specified');
  });

  it('goto clears pushed lines', () => {
    const r = new SourceReader(makeHost(), 't.mma', line('PLAY A', 'LABEL X', 'PLAY B'));
    expect(r.read()).toEqual(['PLAY', 'A']);
    r.push([['PUSHED']], [7]);
    r.goto('X');
    expect(r.read()).toEqual(['LABEL', 'X']);
    expect(r.read()).toEqual(['PLAY', 'B']);
  });

  it('push/read: later pushes first, order preserved within a push', () => {
    const host = makeHost();
    const r = new SourceReader(host, 't.mma', line('F1', 'F2'));
    expect(r.read()).toEqual(['F1']);

    host.lineno = 10;
    const batch1: string[][] = [['A'], ['B']];
    const nums1 = [10, 11];
    r.push(batch1, nums1);
    // the caller's arrays keep their order, like Python's reverse/restore
    expect(batch1).toEqual([['A'], ['B']]);
    expect(nums1).toEqual([10, 11]);

    host.lineno = 12;
    r.push([['C']], [13]);

    // The later push is consumed first ...
    expect(r.read()).toEqual(['C']);
    expect(host.lineno).toBe(13);
    // ... then the earlier push in its original order.
    expect(r.read()).toEqual(['A']);
    expect(host.lineno).toBe(10);
    expect(r.read()).toEqual(['B']);
    expect(host.lineno).toBe(11);
    expect(r.read()).toEqual(['F2']); // then back to the file
    expect(host.lineno).toBe(2);
    expect(r.read()).toBeNull();
  });

  it('push skips empty lines and the queue sentinel', () => {
    const host = makeHost();
    host.lineno = 99;
    const r = new SourceReader(host, 't.mma', '');
    const nums = [7, 8, 9];
    r.push([['A'], [], ['B']], nums);
    expect(nums).toEqual([7, 8, 9]);

    const linenos: number[] = [];
    const lines: string[][] = [];
    for (;;) {
      const l = r.read();
      if (l === null) break;
      lines.push(l);
      linenos.push(host.lineno);
    }
    expect(lines).toEqual([['A'], ['B']]);
    expect(linenos).toEqual([7, 9]);
    // the sentinel was popped with the push-time lineno, then EOF was hit
    expect(host.lineno).toBe(99);
  });

  it('toEof stops reading and clears queued lines', () => {
    const r = new SourceReader(makeHost(), 't.mma', line('A', 'B'));
    expect(r.read()).toEqual(['A']);
    r.push([['PUSHED']], [5]);
    r.toEof();
    expect(r.read()).toBeNull();

    const r2 = new SourceReader(makeHost(), 't.mma', line('A'));
    r2.toEof();
    expect(r2.read()).toBeNull();
  });

  it('pushEOFline appends a synthetic line read after the file ends', () => {
    const host = makeHost();
    const r = new SourceReader(host, 't.mma', line('A', 'B'));
    expect(r.read()).toEqual(['A']);
    host.lineno = 42;
    r.pushEOFline(['AFTER', 'EOF']);
    expect(r.read()).toEqual(['B']);
    expect(host.lineno).toBe(2);
    expect(r.read()).toEqual(['AFTER', 'EOF']);
    expect(host.lineno).toBe(42);
    expect(r.read()).toBeNull();
  });

  it('pushEOFline works once the file is exhausted', () => {
    const r = new SourceReader(makeHost(), 't.mma', line('A'));
    expect(r.read()).toEqual(['A']);
    r.pushEOFline(['SYNTH']);
    expect(r.read()).toEqual(['SYNTH']);
    expect(r.read()).toBeNull();
  });
});
