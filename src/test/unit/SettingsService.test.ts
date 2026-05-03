import { SettingsService } from '../../services/SettingsService';
import { workspace } from 'vscode';

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SettingsService();
  });

  describe('getSettings', () => {
    it('returns default settings', () => {
      const settings = service.getSettings();
      expect(settings.defaultTopics).toEqual([]);
      expect(settings.defaultColumn).toBe('');
      expect(settings.publishDirectly).toBe(true);
      expect(settings.contentStyle.themePreset).toBe('classic');
      expect(settings.contentStyle.bodyFontSize).toBe(16);
      expect(settings.contentStyle.lineHeight).toBe(1.85);
      expect(settings.batchRecursive).toBe(false);
      expect(settings.batchContinueOnError).toBe(true);
      expect(settings.batchDelaySeconds).toBe(3);
      expect(settings.batchFileOrder).toBe('name-asc');
      expect(settings.batchDryRunDefault).toBe(true);
    });

    it('returns content style settings', () => {
      const settings = service.getSettings();
      expect(settings.contentStyle.textColor).toBe('#1f2329');
      expect(settings.contentStyle.headingColor).toBe('#0f172a');
      expect(settings.contentStyle.linkColor).toBe('#0969da');
    });
  });

  describe('updateSettings', () => {
    it('calls config.update for each setting', async () => {
      const settings = service.getSettings();
      await service.updateSettings(settings);
      const config = workspace.getConfiguration();
      expect(config.update).toHaveBeenCalled();
    });
  });
});
