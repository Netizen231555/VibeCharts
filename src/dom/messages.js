/**
 * DOM-host interface text; language follows the chart `locale` option.
 * A key missing from either table throws.
 */
import { createTranslator } from '../i18n.js';

export const translate = createTranslator({
  en: { 'labels.otherValues': 'Other values' },
  ru: { 'labels.otherValues': 'Другие значения' },
});
