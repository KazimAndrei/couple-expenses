// QA: учёт «since / seen / pending» и дедупликация в collectPayments (нативный плагин подменён).
// it.fails — найденные баги: тест «проходит», пока баг есть.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const plugin = vi.hoisted(() => ({
  takeInbox: vi.fn(async () => ({ items: [] })),
  scanPhotos: vi.fn(async () => ({ status: 'granted', items: [] })),
  clearInbox: vi.fn(async () => ({})),
  photoAccess: vi.fn(async () => ({ status: 'granted' })),
}));
const native = vi.hoisted(() => ({ on: true }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.on, getPlatform: () => (native.on ? 'ios' : 'web') },
  registerPlugin: () => plugin,
}));
vi.mock('../lib/i18n.js', () => ({ getLang: () => 'ru' }));

const store = new Map();
vi.stubGlobal('localStorage', {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
});

const { collectPayments, markSeen, readSlipSettings, writeSlipSettings, seenKeys, clearInbox } = await import('./capture.js');

const NOW = new Date('2026-10-28T20:00:00+07:00');
const JPEG = Buffer.from('fake').toString('base64');
const rows = (texts) => texts.map((t, i) => ({ t, x: 0.1, y: 0.1 + i * 0.05, w: 0.3, h: 0.02 }));
// Слип с QR проверки (есть ключ) и без него (ключ null)
const slipWithRef = { lines: rows(['TrueMoney', '฿ 115.00', 'Transaction date 28 Oct 2026 17:04']), qr: ['0046000600000101030250225APF261028170424OB74ODTAG15102TH9104FB22'] };
const slipNoRef = { lines: rows(['K PLUS', 'Transfer successful', '28 Oct 2026 17:04', 'Amount 250.00 THB']), qr: [] };
const inboxItem = (id, ocr) => ({ id, created: Number(id.split('-')[0]), data: JPEG, ...ocr });
const photoItem = (id, created, ocr) => ({ id, created, ...ocr });

beforeEach(() => {
  store.clear();
  native.on = true;
  Object.values(plugin).forEach((fn) => fn.mockReset());
  plugin.takeInbox.mockResolvedValue({ items: [] });
  plugin.scanPhotos.mockResolvedValue({ status: 'granted', items: [] });
  plugin.clearInbox.mockResolvedValue({});
});

describe('collectPayments: работает', () => {
  it('веб-сборка: ничего не вызывает и возвращает []', async () => {
    native.on = false;
    expect(await collectPayments({ now: NOW })).toEqual([]);
    expect(plugin.takeInbox).not.toHaveBeenCalled();
  });

  it('две копии одного слипа во входящих → одна строка, обе копии будут удалены', async () => {
    plugin.takeInbox.mockResolvedValue({ items: [inboxItem('1-a.jpg', slipWithRef), inboxItem('2-b.jpg', slipWithRef)] });
    const items = await collectPayments({ now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0].inboxIds.sort()).toEqual(['1-a.jpg', '2-b.jpg']);
    await clearInbox(items);
    expect(plugin.clearInbox).toHaveBeenCalledWith({ ids: expect.arrayContaining(['1-a.jpg', '2-b.jpg']) });
  });

  it('найденное в Фото сохраняется в pending и возвращается без повторного скана; since двигается', async () => {
    writeSlipSettings({ enabled: true, since: NOW.getTime() - 86400000 });
    plugin.scanPhotos.mockResolvedValue({ status: 'granted', items: [photoItem('P1', NOW.getTime() - 1000, slipNoRef)], processedUntil: NOW.getTime() - 1000 });
    const first = await collectPayments({ now: NOW });
    expect(first).toHaveLength(1);
    expect(readSlipSettings().since).toBe(NOW.getTime() - 1000);
    expect(readSlipSettings().pending).toHaveLength(1);
    const again = await collectPayments({ now: NOW, scanPhotos: false });
    expect(again.map((i) => i.assetId)).toEqual(['P1']);
    markSeen(again.flatMap(seenKeys));
    expect(readSlipSettings().pending).toHaveLength(0);
    expect(await collectPayments({ now: NOW, scanPhotos: false })).toEqual([]);
  });

  it('уже отмеченный (по ключу) слип в Фото не предлагается второй раз', async () => {
    writeSlipSettings({ enabled: true, seen: ['ref:APF261028170424OB74ODTAG1'] });
    plugin.scanPhotos.mockResolvedValue({ status: 'granted', items: [photoItem('P2', NOW.getTime(), slipWithRef)], processedUntil: NOW.getTime() });
    expect(await collectPayments({ now: NOW })).toEqual([]);
  });

  it('тайм-аут/ошибка плагина не роняет проверку, since не двигается', async () => {
    writeSlipSettings({ enabled: true, since: 123 });
    plugin.takeInbox.mockRejectedValue(new Error('not implemented'));
    plugin.scanPhotos.mockRejectedValue(new Error('vision'));
    expect(await collectPayments({ now: NOW })).toEqual([]);
    expect(readSlipSettings().since).toBe(123);
  });

  it('битый JSON настроек → значения по умолчанию; seen ограничен 400', () => {
    store.set('ce_slip_import_v1', '{bad');
    expect(readSlipSettings()).toEqual({ enabled: null, since: 0, seen: [], pending: [] });
    writeSlipSettings({ seen: Array.from({ length: 1000 }, (_, i) => `asset:${i}`) });
    expect(readSlipSettings().seen).toHaveLength(400);
    expect(readSlipSettings().seen[0]).toBe('asset:600');
  });

  it('отказ в доступе к Фото выключает импорт', async () => {
    writeSlipSettings({ enabled: true });
    plugin.scanPhotos.mockResolvedValue({ status: 'denied', items: [] });
    await collectPayments({ now: NOW });
    expect(readSlipSettings().enabled).toBe(false);
  });
});

describe('collectPayments: найденные баги', () => {
  // capture.js:89-93 — входящие не сверяются с seen. В runPaymentCheck предупреждение «уже добавлен»
  // есть только для одиночного файла (home-page.js ~1205); при 2+ файлах лист предлагает их с галочкой → дубль расхода
  it('уже добавленный слип, присланный вместе с другим через «Поделиться», помечается/отсеивается', async () => {
    writeSlipSettings({ enabled: true, seen: ['ref:APF261028170424OB74ODTAG1'] });
    plugin.takeInbox.mockResolvedValue({ items: [inboxItem('1-a.jpg', slipWithRef), inboxItem('2-b.jpg', slipNoRef)] });
    const items = await collectPayments({ now: NOW });
    const dup = items.find((i) => i.slip.key === 'ref:APF261028170424OB74ODTAG1');
    expect(dup === undefined || dup.alreadyAdded === true).toBe(true);
  });

  // Слип без QR/номера (key null) дедуплицируется только по asset:id. Присланный через «Поделиться»
  // и затем найденный в Фото — снова предлагается (inbox id ≠ asset id)
  it('слип без номера: добавлен через «Поделиться», потом найден в Фото → не предлагать снова', async () => {
    writeSlipSettings({ enabled: true, since: NOW.getTime() - 86400000 });
    plugin.takeInbox.mockResolvedValueOnce({ items: [inboxItem('1-a.jpg', slipNoRef)] });
    const shared = await collectPayments({ now: NOW });
    expect(shared).toHaveLength(1);
    markSeen(seenKeys(shared[0])); // как делает runPaymentCheck для одиночного файла
    plugin.scanPhotos.mockResolvedValue({ status: 'granted', items: [photoItem('P9', NOW.getTime() - 500, slipNoRef)], processedUntil: NOW.getTime() - 500 });
    expect(await collectPayments({ now: NOW })).toEqual([]);
  });
});
