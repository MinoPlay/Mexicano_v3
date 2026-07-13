import { describe, it, expect } from 'vitest';
import { buildTelegramUrl, parseTelegramConfig } from '../../js/services/telegram.js';

describe('buildTelegramUrl', () => {
  it('builds a Telegram sendMessage URL with encoded text', () => {
    const url = buildTelegramUrl('123:ABC', '-5375683887', '🎾 hi there & bye');
    expect(url).toBe(
      'https://api.telegram.org/bot123:ABC/sendMessage?chat_id=-5375683887&text=%F0%9F%8E%BE%20hi%20there%20%26%20bye'
    );
  });
});

describe('parseTelegramConfig', () => {
  it('reads telegram_alerts.bot_token and chat_id', () => {
    const cfg = { telegram_alerts: { bot_token: ' 8844:AAF ', chat_id: ' -5375683887 ' } };
    expect(parseTelegramConfig(cfg)).toEqual({ botToken: '8844:AAF', chatId: '-5375683887' });
  });

  it('returns empty strings when config missing', () => {
    expect(parseTelegramConfig(undefined)).toEqual({ botToken: '', chatId: '' });
    expect(parseTelegramConfig({})).toEqual({ botToken: '', chatId: '' });
  });
});
