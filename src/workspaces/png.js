import { WorkspaceError, fail } from './errors.js';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(input) {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function toBlobFromDataUrl(canvas, chartId) {
  let dataUrl;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (error) {
    fail('png-unavailable', `Canvas for chart "${chartId}" is tainted or unreadable: ${error.message}`, { chartId, field: 'canvas' });
  }
  const marker = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/png;base64,') || marker === -1) {
    fail('png-failed', `Canvas for chart "${chartId}" produced no PNG data URL`, { chartId, field: 'canvas' });
  }
  return new Blob([decodeBase64(dataUrl.slice(marker + 1))], { type: 'image/png' });
}

function canvasToPngBlob(canvas, chartId) {
  if (typeof canvas.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new WorkspaceError('png-unavailable', `Canvas for chart "${chartId}" is tainted or unreadable`, { chartId, field: 'canvas' }));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  }
  if (typeof canvas.convertToBlob === 'function') {
    return Promise.resolve(canvas.convertToBlob({ type: 'image/png' })).catch((error) => {
      throw new WorkspaceError('png-unavailable', `Canvas for chart "${chartId}" cannot be encoded: ${error.message}`, {
        chartId,
        field: 'canvas',
      });
    });
  }
  if (typeof canvas.toDataURL === 'function') {
    return Promise.resolve(toBlobFromDataUrl(canvas, chartId));
  }
  fail('png-unavailable', `Chart "${chartId}" exposes no readable canvas`, { chartId, field: 'canvas' });
  return null;
}

/**
 * Exports the chart's current visible canvas as a PNG Blob. Displayed state is
 * captured by the adapter's export call; this helper never requests data or
 * mutates workspace/chart state, and it rejects instead of returning a fake PNG.
 */
export async function exportChartPng(chart, { chartId, isAlive = () => true, canvas = null } = {}) {
  if (!isAlive()) fail('destroyed', `Cannot export chart "${chartId}": it is destroyed`, { chartId, field: 'chartId' });
  const targetCanvas =
    canvas ?? chart?.canvas ?? (typeof chart?.element?.querySelector === 'function' ? chart.element.querySelector('canvas') : null);
  let blob;
  if (chart && typeof chart.exportPng === 'function') {
    try {
      blob = await chart.exportPng();
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError('png-failed', `PNG export failed for chart "${chartId}": ${error.message}`, {
        chartId,
        field: 'exportPng',
        cause: error,
      });
    }
  } else if (targetCanvas) {
    blob = await canvasToPngBlob(targetCanvas, chartId);
  } else {
    fail('png-unavailable', `Chart "${chartId}" exposes neither exportPng nor a canvas`, { chartId, field: 'canvas' });
  }
  if (!isAlive()) fail('destroyed', `Chart "${chartId}" was destroyed before PNG export completed`, { chartId, field: 'chartId' });
  if (!blob || typeof blob !== 'object' || typeof blob.size !== 'number') {
    fail('png-failed', `PNG export for chart "${chartId}" returned no Blob`, { chartId, field: 'exportPng' });
  }
  if (blob.size === 0) fail('png-failed', `PNG export for chart "${chartId}" returned an empty image`, { chartId, field: 'exportPng' });
  if (blob.type !== 'image/png') {
    fail('png-failed', `PNG export for chart "${chartId}" produced "${blob.type || 'unknown'}" instead of image/png`, {
      chartId,
      field: 'exportPng',
    });
  }
  return blob;
}
