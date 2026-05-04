import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import type { Logger } from './Logger';

declare const window: any;
declare const document: any;
type SVGSVGElement = any;

const MERMAID_RUNTIME_RELATIVE_PATH = path.join('mermaid', 'dist', 'mermaid.min.js');
const RENDER_TIMEOUT_MS = 10_000;
const MAX_DIMENSION = 2000;

export class MermaidImageRenderer {
  private runtimeSource: string | null = null;

  constructor(private logger: Logger) {}

  async replaceMermaidBlocks(markdown: string): Promise<string> {
    const blocks: string[] = [];
    const markdownWithTokens = markdown.replace(/```mermaid\s*([\s\S]*?)```/g, (_match, code: string) => {
      const token = `ZHIHUPOST_MERMAID_${blocks.length}_${Date.now()}`;
      blocks.push(code.trim());
      return token;
    });

    if (blocks.length === 0) {
      return markdown;
    }

    let result = markdownWithTokens;
    for (let index = 0; index < blocks.length; index += 1) {
      const tokenPrefix = `ZHIHUPOST_MERMAID_${index}_`;
      const token = result.match(new RegExp(`${tokenPrefix}\\d+`))?.[0];
      if (!token) {
        continue;
      }

      const filePath = await this.renderToTempPng(blocks[index], index);
      const replacement = filePath
        ? `<p><img src="${this.escapeHtmlAttr(filePath)}" alt="Mermaid Diagram ${index + 1}" style="max-width:100%;height:auto;" /></p>`
        : this.toMermaidCodeBlock(blocks[index]);
      result = result.replace(token, replacement);
    }

    return result;
  }

  private async renderToTempPng(diagramCode: string, index: number): Promise<string | null> {
    const traceId = `mermaid-${Date.now()}-${index}-${diagramCode.length}`;
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--disable-dev-shm-usage', '--no-sandbox'],
      });
      const page = await browser.newPage({ viewport: { width: MAX_DIMENSION, height: MAX_DIMENSION } });
      await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({ content: this.getRuntimeSource() });

      const containerId = await this.renderDiagramOnPage(page, diagramCode, traceId);
      if (!containerId) {
        return null;
      }

      const target = page.locator(`#${containerId}`);
      await target.waitFor({ state: 'visible', timeout: RENDER_TIMEOUT_MS });
      const buffer = await target.screenshot({ type: 'png' });
      const filePath = path.join(
        os.tmpdir(),
        `zhihupost-mermaid-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.png`,
      );
      fs.writeFileSync(filePath, buffer);
      this.logger.info('Mermaid: rendered PNG', {
        traceId,
        filePath,
        bytes: buffer.length,
      });
      return filePath;
    } catch (error: unknown) {
      this.logger.warn('Mermaid: render failed; keeping code block', {
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      await browser?.close().catch((error) => {
        this.logger.warn('Mermaid: failed to close browser', error);
      });
    }
  }

  private async renderDiagramOnPage(page: Page, diagramCode: string, traceId: string): Promise<string | null> {
    return page.evaluate(
      async ({ code, currentTraceId, maxDimension }) => {
        const mermaidApi = (window as any).mermaid;
        if (!mermaidApi) {
          return null;
        }

        const parseDimension = (value: string | null): number | null => {
          if (!value) {
            return null;
          }
          const normalized = value.trim().toLowerCase();
          const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(px)?$/);
          if (!match) {
            return null;
          }
          const parsed = Number.parseFloat(match[1]);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        };

        const getIntrinsicSize = (svgEl: SVGSVGElement): { width: number; height: number } => {
          const viewBox = svgEl.getAttribute('viewBox');
          if (viewBox) {
            const parts = viewBox.trim().split(/\s+/).map((item: string) => Number.parseFloat(item));
            if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3]) && parts[2] > 0 && parts[3] > 0) {
              return { width: parts[2], height: parts[3] };
            }
          }

          const widthAttr = parseDimension(svgEl.getAttribute('width'));
          const heightAttr = parseDimension(svgEl.getAttribute('height'));
          if (widthAttr && heightAttr) {
            return { width: widthAttr, height: heightAttr };
          }

          const rect = svgEl.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { width: rect.width, height: rect.height };
          }

          return { width: 1200, height: 675 };
        };

        mermaidApi.initialize({ startOnLoad: false, securityLevel: 'loose' });
        if (typeof mermaidApi.parse === 'function') {
          await mermaidApi.parse(code);
        }

        const containerId = `zhihupost-mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const host = document.createElement('div');
        host.id = containerId;
        host.style.position = 'absolute';
        host.style.left = '0';
        host.style.top = '0';
        host.style.padding = '8px';
        host.style.background = '#ffffff';
        host.style.display = 'inline-block';
        document.body.appendChild(host);

        const renderId = `zhihupost-mermaid-render-${currentTraceId}`;
        const rendered = await mermaidApi.render(renderId, code, host);
        host.innerHTML = rendered.svg as string;

        const svgEl = host.querySelector('svg');
        if (!svgEl) {
          host.remove();
          return null;
        }

        const intrinsic = getIntrinsicSize(svgEl);
        const scale = Math.min(1, maxDimension / Math.max(intrinsic.width, intrinsic.height));
        svgEl.setAttribute('width', `${Math.max(1, Math.ceil(intrinsic.width * scale))}`);
        svgEl.setAttribute('height', `${Math.max(1, Math.ceil(intrinsic.height * scale))}`);
        return containerId;
      },
      { code: diagramCode, currentTraceId: traceId, maxDimension: MAX_DIMENSION },
    );
  }

  private getRuntimeSource(): string {
    if (this.runtimeSource) {
      return this.runtimeSource;
    }

    const runtimePath = require.resolve(MERMAID_RUNTIME_RELATIVE_PATH);
    this.runtimeSource = fs.readFileSync(runtimePath, 'utf8');
    return this.runtimeSource;
  }

  private toMermaidCodeBlock(diagramCode: string): string {
    return `\n\`\`\`mermaid\n${diagramCode}\n\`\`\`\n`;
  }

  private escapeHtmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
