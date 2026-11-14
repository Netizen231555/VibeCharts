import { mountTimeline } from './timeline.js';
import { mountVersionedFeed } from './versioned-feed.js';

const root = document.querySelector<HTMLElement>('#chart');
const status = document.querySelector<HTMLElement>('#status');
const select = document.querySelector<HTMLSelectElement>('#example');
const mount = document.querySelector<HTMLButtonElement>('#mount');
const remove = document.querySelector<HTMLButtonElement>('#remove');
if (!root || !status || !select || !mount || !remove) throw new Error('Example controls are missing');

let dispose: (() => void) | undefined;
let generation = 0;
remove.addEventListener('click', () => {
  generation++;
  dispose?.();
  dispose = undefined;
  status.textContent = 'Chart removed';
});
mount.addEventListener('click', async () => {
  const current = ++generation;
  dispose?.();
  dispose = undefined;
  status.textContent = 'Loading synthetic example…';
  try {
    const cleanup = select.value === 'feed'
      ? await mountVersionedFeed(root, (message) => {
          if (status.textContent === 'Loading synthetic example…') status.textContent = '';
          status.textContent += `\n${message}`;
        })
      : mountTimeline(root, select.value === 'timed');
    if (generation !== current) cleanup();
    else {
      dispose = cleanup;
      if (select.value !== 'feed') status.textContent = 'Synthetic static history: continuity is not guaranteed';
    }
  } catch (error) {
    status.textContent = `Example failed: ${error instanceof Error ? error.message : String(error)}`;
  }
});
window.addEventListener('pagehide', () => { generation++; dispose?.(); });
