// Shared fixtures of the drawing settings tests: a deterministic geometry adapter and a store over it.
import { createDrawingStore } from '../src/drawings/store.js';

const BARS = Array.from({ length: 30 }, (_, i) => ({ barId: `b${i}` }));
const geometry = {
  hasBinding: ({ paneId }) => paneId === 'main',
  getVisibleRect: () => ({ x: 0, y: 0, width: 300, height: 200 }),
  resolveX: anchor => {
    const index = BARS.findIndex(bar => bar.barId === anchor.anchorBarId);
    return index < 0 ? null : index + anchor.offset;
  },
  logicalToX: logical => logical * 10,
  priceToY: price => 200 - price * 2,
  getPriceScaleMode: () => 'linear',
  yToPrice: y => (200 - y) / 2,
  getIndexCount: () => BARS.length,
  getSlot: index => BARS[index] ?? null,
  indexOf: barId => BARS.findIndex(bar => bar.barId === barId),
  getSeriesValues: () => null,
};
export const makeStore = () => createDrawingStore({ context: { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' }, geometry, historyLimit: 30 });
