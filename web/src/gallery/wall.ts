import type { Page, Submission } from '@solcollab/shared';
import { api, element } from '../ui/dom';

// A cell is one standard square on the outer grid. Clusters split a cell on a
// 6 × 6 sub-grid so thirds (2), halves (3), and two-thirds (4) always tessellate.
interface Shape {
  kind: 'single' | 'large' | 'halves' | 'corner' | 'thirds';
  count: number;
  corner: number;
}
const sizes: Record<string, string> = {
  large: '(max-width: 560px) 100vw, 40vw',
  single: '(max-width: 560px) 50vw, 22vw',
  half: '(max-width: 560px) 25vw, 11vw',
  'two-thirds': '(max-width: 560px) 34vw, 15vw',
  third: '(max-width: 560px) 17vw, 8vw',
};

function random(seed: number) {
  // mulberry32: small, seedable, and good enough for layout choices.
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wallView(
  root: HTMLElement,
  options: { wall?: number; seed: number },
) {
  let disposed = false,
    loading = false,
    cursor: string | null = null,
    started = false;
  const next = random(options.seed),
    queue: Submission[] = [];
  const heading = element(
    'h1',
    'visually-hidden',
    options.wall ? `Wall ${options.wall}` : 'Explore prompts',
  );
  const grid = element('div', 'wall-masonry'),
    status = element('p', 'load-status'),
    sentinel = element('div', 'scroll-sentinel');
  status.setAttribute('role', 'status');
  root.append(heading, grid, status, sentinel);

  const piece = (item: Submission, size: string) => {
    const anchor = element('a', `wall-piece ${size}`);
    anchor.href = `${options.wall ? `/w/${options.wall}` : ''}/p/${encodeURIComponent(item.prompt_slug)}/${item.id}`;
    anchor.dataset.id = item.id;
    anchor.style.background = item.background;
    const image = element('img');
    image.src = item.thumb_url;
    image.srcset = `${item.thumb_url} 320w, ${item.full_url} 1000w`;
    image.sizes = sizes[size]!;
    image.width = image.height = 320;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = `Drawing ${item.number} by ${item.display_name ?? 'an anonymous artist'}`;
    anchor.append(image);
    return anchor;
  };
  const place = (block: Shape, items: Submission[]) => {
    if (block.kind === 'single' || block.kind === 'large') {
      grid.append(piece(items[0]!, block.kind));
      return;
    }
    const cluster = element('div', `wall-cluster ${block.kind}`);
    items.forEach((item, index) => {
      if (block.kind === 'halves') cluster.append(piece(item, 'half'));
      else if (block.kind === 'thirds') cluster.append(piece(item, 'third'));
      else if (index === 0) {
        const node = piece(item, 'two-thirds');
        // Pin the two-thirds square to one corner; thirds auto-fill the L around it.
        node.style.gridColumn = block.corner & 1 ? '3 / 7' : '1 / 5';
        node.style.gridRow = block.corner & 2 ? '3 / 7' : '1 / 5';
        cluster.append(node);
      } else cluster.append(piece(item, 'third'));
    });
    grid.append(cluster);
  };
  // Choose a block shape, then wait for enough drawings to fill it; the final page falls back to singles.
  let shape: Shape | undefined;
  const flush = (final: boolean) => {
    for (;;) {
      if (!shape) {
        const roll = next();
        shape =
          roll < 0.12
            ? { kind: 'large', count: 1, corner: 0 }
            : roll < 0.26
              ? { kind: 'halves', count: 4, corner: 0 }
              : roll < 0.36
                ? { kind: 'corner', count: 6, corner: Math.floor(next() * 4) }
                : roll < 0.42
                  ? { kind: 'thirds', count: 9, corner: 0 }
                  : { kind: 'single', count: 1, corner: 0 };
      }
      if (queue.length < shape.count) {
        if (!final || !queue.length) return;
        shape = { kind: 'single', count: 1, corner: 0 };
      }
      place(shape, queue.splice(0, shape.count));
      shape = undefined;
    }
  };
  const load = async () => {
    if (disposed || loading || (started && !cursor)) return;
    loading = true;
    status.textContent = 'Looking along the wall…';
    const query = new URLSearchParams({ seed: String(options.seed) });
    if (options.wall) query.set('wall', String(options.wall));
    if (cursor) query.set('cursor', cursor);
    try {
      const page = await api<Page<Submission>>(`/api/submissions?${query}`);
      if (disposed) return;
      queue.push(...page.items);
      cursor = page.next_cursor;
      started = true;
      flush(!cursor);
      status.textContent = grid.childElementCount
        ? ''
        : 'No drawings on this wall yet.';
    } catch (error) {
      if (!disposed) status.textContent = (error as Error).message;
      return;
    } finally {
      loading = false;
    }
    // A short page may leave the sentinel in view without a new intersection.
    if (
      !disposed &&
      cursor &&
      sentinel.getBoundingClientRect().top < innerHeight + 1200
    )
      void load();
  };
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load();
    },
    { rootMargin: '1200px' },
  );
  observer.observe(sentinel);
  void load();
  return () => {
    disposed = true;
    observer.disconnect();
  };
}
