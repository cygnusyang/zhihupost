import { MarkdownRenderer } from '../../utils/MarkdownRenderer';
import type { ContentStyleSettings } from '../../services/SettingsService';

const DEFAULT_STYLE: ContentStyleSettings = {
  themePreset: 'classic',
  bodyFontSize: 16,
  lineHeight: 1.85,
  textColor: '#1f2329',
  headingColor: '#0f172a',
  linkColor: '#0969da',
};

describe('MarkdownRenderer', () => {
  let renderer: MarkdownRenderer;

  beforeEach(() => {
    renderer = new MarkdownRenderer();
  });

  it('renders basic markdown to HTML', () => {
    const result = renderer.render('# Title\nHello **world**', DEFAULT_STYLE);
    expect(result).toContain('<strong>world</strong>');
  });

  it('strips leading H1 heading', () => {
    const result = renderer.render('# My Title\nBody text', DEFAULT_STYLE);
    expect(result).toContain('Body text');
    expect(result).not.toMatch(/<h1[^>]*>My Title<\/h1>/);
  });

  it('applies themed styles as inline CSS', () => {
    const result = renderer.render('Hello', DEFAULT_STYLE);
    expect(result).toContain('font-size: 16px');
    expect(result).toContain('line-height: 1.85');
    expect(result).toContain('color: #1f2329');
  });

  it('uses magazine theme font', () => {
    const style = { ...DEFAULT_STYLE, themePreset: 'magazine' as const };
    const result = renderer.render('Hello', style);
    expect(result).toContain('Helvetica Neue');
  });

  it('uses minimal theme font', () => {
    const style = { ...DEFAULT_STYLE, themePreset: 'minimal' as const };
    const result = renderer.render('Hello', style);
    expect(result).toContain('Inter');
  });

  it('preserves H2 and lower headings', () => {
    const result = renderer.render('## Section\nContent', DEFAULT_STYLE);
    expect(result).toContain('<h2');
  });

  it('wraps output in a styled div', () => {
    const result = renderer.render('Test', DEFAULT_STYLE);
    expect(result).toMatch(/^<div style="/);
    expect(result).toMatch(/<\/div>$/);
  });
});
