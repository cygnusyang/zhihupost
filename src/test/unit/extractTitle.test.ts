import { extractTitle } from '../../utils/extractTitle';

describe('extractTitle', () => {
  it('extracts H1 title from markdown', () => {
    const md = '# Hello World\nSome content';
    expect(extractTitle(md)).toBe('Hello World');
  });

  it('extracts title with leading/trailing whitespace', () => {
    const md = '#   Spaced Title   \nContent';
    expect(extractTitle(md)).toBe('Spaced Title');
  });

  it('returns null when no H1 heading exists', () => {
    const md = '## Only H2\nContent';
    expect(extractTitle(md)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractTitle('')).toBeNull();
  });

  it('picks the first H1 when multiple exist', () => {
    const md = '# First\n# Second';
    expect(extractTitle(md)).toBe('First');
  });

  it('matches H1 not at the start of the file', () => {
    const md = 'Intro text\n# Title Here\nMore text';
    expect(extractTitle(md)).toBe('Title Here');
  });
});
