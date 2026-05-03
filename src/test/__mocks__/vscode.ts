export const workspace = {
  getConfiguration: jest.fn().mockReturnValue({
    get: jest.fn((key: string, defaultValue: unknown) => {
      const defaults: Record<string, unknown> = {
        defaultTopics: [],
        defaultColumn: '',
        publishDirectly: true,
        contentThemePreset: 'classic',
        contentBodyFontSize: 16,
        contentLineHeight: 1.85,
        contentTextColor: '#1f2329',
        contentHeadingColor: '#0f172a',
        contentLinkColor: '#0969da',
        batchRecursive: false,
        batchContinueOnError: true,
        batchDelaySeconds: 3,
        batchFileOrder: 'name-asc',
        batchDryRunDefault: true,
      };
      return defaults[key] ?? defaultValue;
    }),
    update: jest.fn().mockResolvedValue(undefined),
  }),
  openTextDocument: jest.fn(),
};

export const ConfigurationTarget = { Global: 1 };

export const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showQuickPick: jest.fn(),
  showInputBox: jest.fn(),
  showOpenDialog: jest.fn(),
  withProgress: jest.fn(),
  showTextDocument: jest.fn(),
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export const env = {
  openExternal: jest.fn(),
};

export const Uri = {
  parse: jest.fn(),
  file: (fsPath: string) => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` }),
};

export enum ProgressLocation {
  Notification = 15,
}
