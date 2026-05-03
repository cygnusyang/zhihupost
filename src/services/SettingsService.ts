import * as vscode from 'vscode';

export interface ContentStyleSettings {
  themePreset: 'classic' | 'magazine' | 'minimal';
  bodyFontSize: number;
  lineHeight: number;
  textColor: string;
  headingColor: string;
  linkColor: string;
}

export interface ExtensionSettings {
  defaultTopics: string[];
  defaultColumn: string;
  publishDirectly: boolean;
  batchRecursive: boolean;
  batchContinueOnError: boolean;
  batchDelaySeconds: number;
  batchFileOrder: 'name-asc' | 'name-desc' | 'mtime-asc' | 'mtime-desc';
  batchDryRunDefault: boolean;
  contentStyle: ContentStyleSettings;
}

export class SettingsService {
  getSettings(): ExtensionSettings {
    const config = vscode.workspace.getConfiguration('zhihuPublisher');
    return {
      defaultTopics: config.get('defaultTopics', []),
      defaultColumn: config.get('defaultColumn', ''),
      publishDirectly: config.get('publishDirectly', true),
      batchRecursive: config.get('batchRecursive', false),
      batchContinueOnError: config.get('batchContinueOnError', true),
      batchDelaySeconds: config.get('batchDelaySeconds', 3),
      batchFileOrder: config.get('batchFileOrder', 'name-asc'),
      batchDryRunDefault: config.get('batchDryRunDefault', true),
      contentStyle: {
        themePreset: config.get('contentThemePreset', 'classic'),
        bodyFontSize: config.get('contentBodyFontSize', 16),
        lineHeight: config.get('contentLineHeight', 1.85),
        textColor: config.get('contentTextColor', '#1f2329'),
        headingColor: config.get('contentHeadingColor', '#0f172a'),
        linkColor: config.get('contentLinkColor', '#0969da'),
      },
    };
  }

  async updateSettings(settings: ExtensionSettings): Promise<void> {
    const config = vscode.workspace.getConfiguration('zhihuPublisher');
    await config.update('defaultTopics', settings.defaultTopics, vscode.ConfigurationTarget.Global);
    await config.update('defaultColumn', settings.defaultColumn, vscode.ConfigurationTarget.Global);
    await config.update('publishDirectly', settings.publishDirectly, vscode.ConfigurationTarget.Global);
    await config.update('batchRecursive', settings.batchRecursive, vscode.ConfigurationTarget.Global);
    await config.update('batchContinueOnError', settings.batchContinueOnError, vscode.ConfigurationTarget.Global);
    await config.update('batchDelaySeconds', settings.batchDelaySeconds, vscode.ConfigurationTarget.Global);
    await config.update('batchFileOrder', settings.batchFileOrder, vscode.ConfigurationTarget.Global);
    await config.update('batchDryRunDefault', settings.batchDryRunDefault, vscode.ConfigurationTarget.Global);
    await config.update('contentThemePreset', settings.contentStyle.themePreset, vscode.ConfigurationTarget.Global);
    await config.update('contentBodyFontSize', settings.contentStyle.bodyFontSize, vscode.ConfigurationTarget.Global);
    await config.update('contentLineHeight', settings.contentStyle.lineHeight, vscode.ConfigurationTarget.Global);
    await config.update('contentTextColor', settings.contentStyle.textColor, vscode.ConfigurationTarget.Global);
    await config.update('contentHeadingColor', settings.contentStyle.headingColor, vscode.ConfigurationTarget.Global);
    await config.update('contentLinkColor', settings.contentStyle.linkColor, vscode.ConfigurationTarget.Global);
  }
}
