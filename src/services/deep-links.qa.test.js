// QA: разбор ссылок coupleexpenses://… из виджетов (src/services/deep-links.js)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listeners = {};
let launchUrl = null;
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' }, registerPlugin: () => ({}) }));
vi.mock('./capture.js', () => ({
  Capture: {
    addListener: vi.fn(async (name, cb) => { listeners[name] = cb; return { remove() {} }; }),
    takeLaunchUrl: vi.fn(async () => (launchUrl ? { url: launchUrl } : {})),
  },
}));
const navigate = vi.fn();
vi.mock('../lib/router.js', () => ({ navigate: (...a) => navigate(...a) }));
const state = { couple: { id: 'c' } };
vi.mock('../lib/store.js', () => ({ getState: () => state }));

const win = new EventTarget();
vi.stubGlobal('window', win);
const events = [];
const rec = (e) => events.push({ type: e.type, detail: e.detail ?? null });
win.addEventListener('ce:add-expense', rec);
win.addEventListener('ce:check-payments', rec);

const { initDeepLinks } = await import('./deep-links.js');

const flush = () => new Promise((r) => setImmediate(r));
const open = (url) => listeners.openUrl({ url });

beforeEach(async () => {
  events.length = 0;
  navigate.mockClear();
  state.couple = { id: 'c' };
  launchUrl = null;
  if (!listeners.openUrl) { initDeepLinks(); await flush(); }
});
afterEach(() => { vi.useRealTimers(); });

describe('deep links', () => {
  it('add / add?mode=voice / add?mode=qr', () => {
    open('coupleexpenses://add');
    open('coupleexpenses://add?mode=voice');
    open('coupleexpenses://add?mode=qr');
    expect(events.map((e) => e.detail.autostart)).toEqual([null, 'voice', 'qr']);
    expect(events.every((e) => e.type === 'ce:add-expense')).toBe(true);
  });

  it('неизвестный mode и регистр: mode=QR → обычная форма; ADD → add', () => {
    open('coupleexpenses://add?mode=QR');
    open('coupleexpenses://add?mode=<script>');
    open('COUPLEEXPENSES://ADD');
    expect(events.map((e) => e.detail.autostart)).toEqual([null, null, null]);
  });

  it('варианты записи: coupleexpenses:add, coupleexpenses:///add, add/лишнее, add#x', () => {
    open('coupleexpenses:add');
    open('coupleexpenses:///add');
    open('coupleexpenses://add/extra/path');
    open('coupleexpenses://add#frag');
    expect(events).toHaveLength(4);
  });

  it('home/goals/analytics → navigate; import → проверка платежей', () => {
    open('coupleexpenses://home');
    open('coupleexpenses://goals');
    open('coupleexpenses://analytics');
    open('coupleexpenses://import');
    expect(navigate.mock.calls.map((c) => c[0])).toEqual(['/', '/goals', '/analytics']);
    expect(events.map((e) => e.type)).toEqual(['ce:check-payments']);
  });

  it('чужие схемы, мусор и неизвестные действия — игнор, без исключений', () => {
    for (const u of ['https://add', 'coupleexpense://add', 'not a url', '', null, undefined, 'coupleexpenses://', 'coupleexpenses://profile', 'coupleexpenses://../../etc', 'javascript:alert(1)']) {
      expect(() => open(u)).not.toThrow();
    }
    expect(events).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('холодный старт: launch URL отдаётся через takeLaunchUrl и обрабатывается после появления пары', async () => {
    vi.useFakeTimers();
    state.couple = null;
    launchUrl = 'coupleexpenses://goals';
    const { Capture } = await import('./capture.js');
    const r = await Capture.takeLaunchUrl();
    listeners.openUrl({ url: r.url }); // тот же handle(), что вызывает initDeepLinks
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    state.couple = { id: 'c' };
    vi.advanceTimersByTime(250);
    expect(navigate).toHaveBeenCalledWith('/goals');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ретраи ждут до минуты (Face ID, медленный вход) и потом завершаются', () => {
    vi.useFakeTimers();
    state.couple = null;
    open('coupleexpenses://add?mode=voice');
    vi.advanceTimersByTime(20_000);
    state.couple = { id: 'c' }; // вход занял 20 с — действие всё равно выполнится
    vi.advanceTimersByTime(500);
    expect(events).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('две ссылки подряд на холодном старте — каждая со своим таймером, обе срабатывают', () => {
    vi.useFakeTimers();
    state.couple = null;
    open('coupleexpenses://add');
    open('coupleexpenses://add?mode=qr');
    state.couple = { id: 'c' };
    vi.advanceTimersByTime(250);
    expect(events.map((e) => e.detail.autostart)).toEqual([null, 'qr']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('«+» в таб-баре шлёт CustomEvent без detail → detail === null (fromLink=false)', () => {
    const ev = new CustomEvent('ce:add-expense');
    expect(ev.detail).toBe(null);
    expect(!!ev.detail).toBe(false);
  });
});
