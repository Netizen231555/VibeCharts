/**
 * Built-in parts by id. Each part is a factory `(controller, context) => { element, destroy? }`.
 * A layout that mounts a built-in part without a factory here is rejected explicitly.
 */
import { createTopBar } from './top-bar.js';
import { createDrawingRail } from './drawing-rail.js';
import { createNavCluster } from './nav-cluster.js';
import { createSettingsMenu } from './settings-menu.js';
import { createStatusLine } from './status-line.js';
import { createDataTable } from './data-table.js';

export const BUILTIN_PART_FACTORIES = Object.freeze({
  topBar: createTopBar,
  drawingRail: createDrawingRail,
  navCluster: createNavCluster,
  settingsMenu: createSettingsMenu,
  statusLine: createStatusLine,
  dataTable: createDataTable,
});
