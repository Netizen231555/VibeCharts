/**
 * Core interface text (errors surfaced to the user); language follows the chart
 * `locale` option. A key missing from either table throws.
 */
import { createTranslator } from '../i18n.js';

export const translate = createTranslator({
  en: {
    'pane.viewConflict': 'Pane {paneId}: independent view {viewId} cannot be shown together with regular series or other views; move it to a separate pane or hide the others',
  },
  ru: {
    'pane.viewConflict': 'Панель {paneId}: независимый вид {viewId} нельзя показать вместе с обычными сериями или другими видами; вынесите его в отдельную панель или скройте остальные',
  },
});
