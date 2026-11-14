/**
 * Interface language follows the chart `locale` option: any `ru` locale selects
 * Russian, everything else selects English. One source of truth keeps the UI,
 * the interaction layer and formatted values consistent.
 */
export function languageOf(locale) {
  return typeof locale === 'string' && /^ru(?:-|$)/i.test(locale) ? 'ru' : 'en';
}

/**
 * Builds a translator from `{ en: {...}, ru: {...} }`. Both tables must define
 * exactly the same keys; a missing key is a programming error and throws, it is
 * never replaced by another language or by the key itself. Placeholders use
 * `{name}` and are filled from `params`; a missing parameter throws.
 */
export function createTranslator(tables) {
  const enKeys = Object.keys(tables.en ?? {});
  const ruKeys = Object.keys(tables.ru ?? {});
  const missing = [...enKeys.filter((key) => !ruKeys.includes(key)), ...ruKeys.filter((key) => !enKeys.includes(key))];
  if (missing.length > 0) throw new Error(`i18n tables differ in keys: ${missing.join(', ')}`);
  return function translate(locale, key, params = {}) {
    const table = tables[languageOf(locale)];
    if (!Object.hasOwn(table, key)) throw new Error(`Unknown i18n key: ${key}`);
    return table[key].replace(/\{(\w+)\}/g, (_, name) => {
      if (!Object.hasOwn(params, name)) throw new Error(`Missing i18n parameter "${name}" for key ${key}`);
      return String(params[name]);
    });
  };
}
