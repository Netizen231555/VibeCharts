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

/** A labelled language `<select>` appended to `container`; choosing a language stores it and reloads the page. */
export function mountLanguageSwitch(container) {
  const lang = resolveLanguage();
  const label = document.createElement('label');
  label.className = 'language-switch';
  const text = document.createElement('span');
  text.textContent = lang === 'ru' ? 'Язык' : 'Language';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Language / Язык');
  for (const entry of LANGUAGES) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.label;
    option.selected = entry.id === lang;
    select.append(option);
  }
  select.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, select.value); } catch { /* storage unavailable: the query parameter still carries the choice */ }
    const url = new URL(location.href);
    url.searchParams.set('lang', select.value);
    location.replace(url);
  });
  label.append(text, select);
  container.append(label);
  return select;
}
