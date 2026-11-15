// Language switch shared by the examples (not part of the package): English by default, Russian as the second
// language. The language is chosen with `?lang=ru` or by the switch, remembered in localStorage, and changed by
// reloading the page, so every string and every chart is built once, in one language.

const STORAGE_KEY = 'vibecharts-example-lang';
const LANGUAGES = [{ id: 'en', label: 'English', locale: 'en-US' }, { id: 'ru', label: 'Русский', locale: 'ru-RU' }];

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function resolveLanguage() {
  const requested = new URLSearchParams(location.search).get('lang') ?? readStored();
  return LANGUAGES.some((entry) => entry.id === requested) ? requested : 'en';
}

/**
 * @param {{ en: Record<string, string>, ru: Record<string, string> }} dictionaries
 *   Every key must exist in both languages; a missing key is an error, not a fallback to the other language.
 */
export function createI18n(dictionaries) {
  const missing = Object.keys(dictionaries.en).filter((key) => !(key in dictionaries.ru))
    .concat(Object.keys(dictionaries.ru).filter((key) => !(key in dictionaries.en)));
  if (missing.length > 0) throw new Error(`i18n: keys missing in one language: ${missing.join(', ')}`);
  const lang = resolveLanguage();
  const entries = dictionaries[lang];
  const info = LANGUAGES.find((entry) => entry.id === lang);

  function t(key, params = {}) {
    if (!(key in entries)) throw new Error(`i18n: unknown key "${key}"`);
    return entries[key].replace(/\{(\w+)\}/g, (_, name) => {
      if (!(name in params)) throw new Error(`i18n: "${key}" needs the parameter "${name}"`);
      return String(params[name]);
    });
  }

  /** Fills `data-i18n="key"` (text) and `data-i18n-attr="attribute:key;attribute:key"` inside `root`, and sets <html lang>. */
  function apply(root = document) {
    document.documentElement.lang = lang;
    for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    for (const element of root.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of element.dataset.i18nAttr.split(';')) {
        const [attribute, key] = pair.split(':').map((part) => part.trim());
        element.setAttribute(attribute, t(key));
      }
    }
  }

  return { lang, locale: info.locale, t, apply };
}

const SWITCH_STYLE = `
.language-switch { display: inline-flex; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 6px; overflow: hidden; font-size: 12px; line-height: 1; }
.language-switch button { margin: 0; padding: 7px 9px; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 600; letter-spacing: .04em; cursor: pointer; opacity: .6; }
.language-switch button + button { border-left: 1px solid color-mix(in srgb, currentColor 35%, transparent); }
.language-switch button:hover { opacity: .9; }
.language-switch button[aria-pressed="true"] { opacity: 1; background: color-mix(in srgb, currentColor 18%, transparent); cursor: default; }
.language-switch button:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
`;

/** A compact EN | RU switch appended to `container`; choosing a language stores it and reloads the page. */
export function mountLanguageSwitch(container) {
  const lang = resolveLanguage();
  if (!document.getElementById('language-switch-style')) {
    const style = document.createElement('style');
    style.id = 'language-switch-style';
    style.textContent = SWITCH_STYLE;
    document.head.append(style);
  }
  const group = document.createElement('div');
  group.className = 'language-switch';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Language / Язык');
  for (const entry of LANGUAGES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.id.toUpperCase();
    button.lang = entry.id;
    button.title = entry.label;
    button.setAttribute('aria-pressed', String(entry.id === lang));
    button.addEventListener('click', () => {
      if (entry.id === lang) return;
      try { localStorage.setItem(STORAGE_KEY, entry.id); } catch { /* storage unavailable: the query parameter still carries the choice */ }
      const url = new URL(location.href);
      url.searchParams.set('lang', entry.id);
      location.replace(url);
    });
    group.append(button);
  }
  container.append(group);
  return group;
}
