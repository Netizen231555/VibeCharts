import { fail } from './errors.js';
import { isPlainObject, requireInteger, uniqueBy } from './util.js';

export const MAX_GRID_DIMENSION = 64;

const cellOf = (id, row, column, rowSpan = 1, columnSpan = 1) => ({ id, row, column, rowSpan, columnSpan });

function rowsShorthand(rows, code) {
  if (!Array.isArray(rows)) fail(code, 'layout.rows must be an array of rows or a number', { field: 'layout.rows' });
  const cells = [];
  let columns = 0;
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      fail(code, `layout.rows[${rowIndex}] must be an array of chart ids`, { field: `layout.rows[${rowIndex}]` });
    }
    columns = Math.max(columns, row.length);
    row.forEach((id, columnIndex) => {
      if (typeof id !== 'string' || id.length === 0) {
        fail(code, `layout.rows[${rowIndex}][${columnIndex}] must be a chart id`, {
          field: `layout.rows[${rowIndex}][${columnIndex}]`,
        });
      }
      cells.push(cellOf(id, rowIndex + 1, columnIndex + 1));
    });
  });
  return { rows: rows.length, columns, cells };
}

function columnsShorthand(columns, code) {
  if (!Array.isArray(columns)) fail(code, 'layout.columns must be an array of columns or a number', { field: 'layout.columns' });
  const cells = [];
  let rows = 0;
  columns.forEach((column, columnIndex) => {
    if (!Array.isArray(column)) {
      fail(code, `layout.columns[${columnIndex}] must be an array of chart ids`, { field: `layout.columns[${columnIndex}]` });
    }
    rows = Math.max(rows, column.length);
    column.forEach((id, rowIndex) => {
      if (typeof id !== 'string' || id.length === 0) {
        fail(code, `layout.columns[${columnIndex}][${rowIndex}] must be a chart id`, {
          field: `layout.columns[${columnIndex}][${rowIndex}]`,
        });
      }
      cells.push(cellOf(id, rowIndex + 1, columnIndex + 1));
    });
  });
  return { rows, columns: columns.length, cells };
}

/**
 * Normalizes grid, row-major and column-major layout input into one canonical
 * `{ type: 'grid', rows, columns, cells }` shape and validates it against the
 * chart ids that actually exist in the workspace.
 */
export function normalizeLayout(input, chartIds, code = 'invalid-layout') {
  if (!isPlainObject(input)) fail(code, 'layout must be an object', { field: 'layout' });
  const knownIds = [...chartIds];
  knownIds.forEach((id, index) => {
    if (typeof id !== 'string' || id.length === 0) {
      fail(code, `chartIds[${index}] must be a non-empty string`, { field: `chartIds[${index}]` });
    }
  });
  uniqueBy(knownIds.map((id) => ({ id })), 'chartIds', 'id', code);
  const known = new Set(knownIds);

  let rows;
  let columns;
  let rawCells;
  if (Array.isArray(input.rows)) {
    ({ rows, columns, cells: rawCells } = rowsShorthand(input.rows, code));
  } else if (Array.isArray(input.columns) && input.rows === undefined) {
    ({ rows, columns, cells: rawCells } = columnsShorthand(input.columns, code));
  } else {
    rows = input.rows;
    columns = input.columns;
    rawCells = input.cells;
    if (input.type !== undefined && input.type !== 'grid') {
      fail(code, `layout.type must be "grid"`, { field: 'layout.type' });
    }
  }

  requireInteger(rows, 'layout.rows', { min: 1, max: MAX_GRID_DIMENSION, code });
  requireInteger(columns, 'layout.columns', { min: 1, max: MAX_GRID_DIMENSION, code });
  if (!Array.isArray(rawCells)) fail(code, 'layout.cells must be an array', { field: 'layout.cells' });
  if (rawCells.length > MAX_GRID_DIMENSION * MAX_GRID_DIMENSION) {
    fail(code, 'layout.cells has too many entries', { field: 'layout.cells' });
  }

  const seenIds = new Set();
  const occupancy = new Map();
  const cells = rawCells.map((raw, index) => {
    const field = `layout.cells[${index}]`;
    if (!isPlainObject(raw)) fail(code, `${field} must be an object`, { field });
    if (typeof raw.id !== 'string' || raw.id.length === 0) {
      fail(code, `${field}.id must be a non-empty string`, { field: `${field}.id` });
    }
    if (!known.has(raw.id)) {
      fail(code, `layout references unknown chart id "${raw.id}"`, { field: `${field}.id` });
    }
    if (seenIds.has(raw.id)) {
      fail(code, `layout places chart "${raw.id}" more than once`, { field: `${field}.id` });
    }
    seenIds.add(raw.id);
    const row = requireInteger(raw.row, `${field}.row`, { min: 1, max: rows, code });
    const column = requireInteger(raw.column, `${field}.column`, { min: 1, max: columns, code });
    const rowSpan = requireInteger(raw.rowSpan === undefined ? 1 : raw.rowSpan, `${field}.rowSpan`, {
      min: 1,
      max: rows,
      code,
    });
    const columnSpan = requireInteger(raw.columnSpan === undefined ? 1 : raw.columnSpan, `${field}.columnSpan`, {
      min: 1,
      max: columns,
      code,
    });
    if (row + rowSpan - 1 > rows) {
      fail(code, `${field} extends beyond the last row`, { field: `${field}.rowSpan` });
    }
    if (column + columnSpan - 1 > columns) {
      fail(code, `${field} extends beyond the last column`, { field: `${field}.columnSpan` });
    }
    for (let r = row; r < row + rowSpan; r += 1) {
      for (let c = column; c < column + columnSpan; c += 1) {
        const key = `${r}:${c}`;
        if (occupancy.has(key)) {
          fail(code, `layout places "${raw.id}" and "${occupancy.get(key)}" in the same cell`, { field: `${field}.id` });
        }
        occupancy.set(key, raw.id);
      }
    }
    return cellOf(raw.id, row, column, rowSpan, columnSpan);
  });

  for (const id of knownIds) {
    if (!seenIds.has(id)) fail(code, `layout does not place chart "${id}"`, { field: 'layout.cells' });
  }

  return { type: 'grid', rows, columns, cells };
}

/** Deterministic placement for a newly added chart: first free cell, else a new row. */
export function placeNewChart(layout, id) {
  if (!layout) {
    return { type: 'grid', rows: 1, columns: 1, cells: [cellOf(id, 1, 1)] };
  }
  const { rows, columns, cells } = layout;
  const occupied = new Set();
  for (const cell of cells) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) {
      for (let c = cell.column; c < cell.column + cell.columnSpan; c += 1) occupied.add(`${r}:${c}`);
    }
  }
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      if (!occupied.has(`${row}:${column}`)) {
        return { type: 'grid', rows, columns, cells: [...cells.map((cell) => ({ ...cell })), cellOf(id, row, column)] };
      }
    }
  }
  if (rows >= MAX_GRID_DIMENSION) fail('invalid-layout', 'layout has no free cell and cannot grow', { field: 'layout.rows' });
  return { type: 'grid', rows: rows + 1, columns, cells: [...cells.map((cell) => ({ ...cell })), cellOf(id, rows + 1, 1)] };
}

export function cellStyle(cell) {
  const rowSpan = cell.rowSpan > 1 ? ` / span ${cell.rowSpan}` : '';
  const columnSpan = cell.columnSpan > 1 ? ` / span ${cell.columnSpan}` : '';
  return {
    gridRow: `${cell.row}${rowSpan}`,
    gridColumn: `${cell.column}${columnSpan}`,
  };
}
