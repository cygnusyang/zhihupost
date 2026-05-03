import MarkdownIt from 'markdown-it';
import type { ContentStyleSettings } from '../services/SettingsService';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

export class MarkdownRenderer {
  render(markdown: string, style: ContentStyleSettings): string {
    const stripped = this.stripLeadingTopLevelHeading(markdown);
    const html = md.render(stripped);
    return this.applyThemedStyles(html, style);
  }

  private stripLeadingTopLevelHeading(markdown: string): string {
    return markdown.replace(/^#\s+.+\n*/, '');
  }

  private applyThemedStyles(html: string, style: ContentStyleSettings): string {
    const themeCSS = this.buildThemeCSS(style);
    return `<div style="${themeCSS}">${html}</div>`;
  }

  private buildThemeCSS(style: ContentStyleSettings): string {
    const presets: Record<string, Partial<CSSProperties>> = {
      classic: { fontFamily: "'Georgia', 'Noto Serif SC', serif" },
      magazine: { fontFamily: "'Helvetica Neue', 'PingFang SC', sans-serif" },
      minimal: { fontFamily: "'Inter', 'Noto Sans SC', sans-serif" },
    };
    const preset = presets[style.themePreset] ?? presets.classic;

    const entries: string[] = [
      `font-family: ${preset.fontFamily ?? 'serif'}`,
      `font-size: ${style.bodyFontSize}px`,
      `line-height: ${style.lineHeight}`,
      `color: ${style.textColor}`,
    ];
    return entries.join('; ');
  }
}

interface CSSProperties {
  fontFamily?: string;
}
