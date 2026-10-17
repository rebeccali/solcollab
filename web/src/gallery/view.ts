import type { Page, PromptDetail, Submission } from '@solcollab/shared';
import { api, button, element, link, relativeTime } from '../ui/dom';
import { Lightbox } from './lightbox';

export interface GalleryView {
  slot: HTMLElement;
  setMine: (item: Submission) => void;
  destroy: () => void;
}
export function galleryView(
  root: HTMLElement,
  slug: string,
  options: {
    wall?: number;
    currentWall: number;
    onPrompt: (prompt: PromptDetail) => void;
    mine?: string;
    localUrl?: string;
    featured?: string;
    onNavigate: (href: string) => void;
  },
): GalleryView {
  let disposed = false,
    loading = false,
    cursor: string | null = null,
    started = false,
    generation = 0;
  const parameters = new URLSearchParams(location.search);
  let sort = parameters.get('sort') === 'random' ? 'random' : 'new',
    bucket = Math.floor(Math.random() * 64);
  const items: Submission[] = [],
    seen = new Set<string>();
  const heading = element('h1', 'page-title', 'The wall');
  const description = element(
    'p',
    'gallery-instruction',
    'Loading the instruction…',
  );
  const meta = element('p', 'muted');
  const tools = element('div', 'view-tools');
  const order = element('select');
  order.setAttribute('aria-label', 'Gallery order');
  for (const [value, text] of [
    ['new', 'Newest'],
    ['random', 'Random'],
  ]) {
    const option = element('option', '', text);
    option.value = value!;
    order.append(option);
  }
  order.value = sort;
  const grid = element('div', 'gallery-grid'),
    slot = element('figure', 'tile mine-slot');
  slot.id = 'mine-slot';
  slot.setAttribute('aria-label', 'Your drawing');
  let pending = !!options.mine;
  if (pending) {
    const label = element(
      'figcaption',
      '',
      'Your drawing · finding its place…',
    );
    slot.append(label);
    if (options.localUrl) {
      const image = element('img');
      image.src = options.localUrl;
      image.width = image.height = 320;
      image.alt = 'Your drawing';
      slot.prepend(image);
    }
    grid.append(slot);
  }
  const status = element('p', 'load-status');
  status.setAttribute('role', 'status');
  const more = button(
    'Load more',
    () => {
      void load();
    },
    'button load-more',
  );
  const sentinel = element('div', 'scroll-sentinel');
  const lightbox = new Lightbox(() => items);
  const tile = (item: Submission) => {
    const figure = element('figure', 'tile');
    figure.dataset.id = item.id;
    const open = button('', () => lightbox.open(item), 'tile-art');
    open.setAttribute(
      'aria-label',
      `Open Drawing ${item.number} by ${item.display_name ?? 'anonymous'}`,
    );
    const image = element('img');
    image.src = item.thumb_url;
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.width = image.height = 320;
    open.append(image);
    figure.append(
      open,
      element(
        'figcaption',
        '',
        `#${String(item.number).padStart(4, '0')} · ${item.display_name ?? 'anonymous'} · ${relativeTime(item.created_at)}`,
      ),
    );
    return figure;
  };
  // Keep metadata for navigation; recycle visible tile DOM once the collection gets large.
  const render = () => {
    if (disposed) return;
    const visible = items.filter(
      (item) => item.id !== options.mine && item.id !== options.featured,
    );
    let start = 0,
      end = visible.length;
    const columns = Math.max(
      1,
      getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    );
    const rowHeight = grid.clientWidth / columns + 34;
    if (visible.length > 600) {
      const offset = Math.max(0, -grid.getBoundingClientRect().top);
      start = Math.max(0, (Math.floor(offset / rowHeight) - 4) * columns);
      start = Math.min(start, Math.max(0, visible.length - 180));
      start -= start % columns;
      end = Math.min(visible.length, start + 240);
    }
    const nodes: HTMLElement[] = [];
    if (pending) nodes.push(slot);
    if (start) {
      const spacer = element('div', 'grid-spacer');
      spacer.style.height = `${Math.floor(start / columns) * rowHeight}px`;
      nodes.push(spacer);
    }
    nodes.push(...visible.slice(start, end).map(tile));
    if (end < visible.length) {
      const spacer = element('div', 'grid-spacer');
      spacer.style.height = `${Math.ceil((visible.length - end) / columns) * rowHeight}px`;
      nodes.push(spacer);
    }
    grid.replaceChildren(...nodes);
  };
  const setMine = (item: Submission) => {
    if (
      disposed ||
      item.prompt_slug !== slug ||
      item.wall !== (options.wall ?? options.currentWall)
    )
      return;
    options.mine = item.id;
    slot.dataset.id = item.id;
    const figure = tile(item);
    slot.replaceChildren(...Array.from(figure.childNodes));
    slot.classList.add('hung');
    slot.querySelector('figcaption')!.textContent =
      `Your drawing · #${item.number}`;
    if (!seen.has(item.id)) {
      items.unshift(item);
      seen.add(item.id);
    }
    render();
    void api<PromptDetail>(
      `/api/prompts/${encodeURIComponent(slug)}${options.wall ? `?wall=${options.wall}` : ''}`,
      { cache: 'no-store' },
    )
      .then((prompt) => {
        if (!disposed) {
          meta.textContent = `${prompt.count} ${prompt.count === 1 ? 'drawing' : 'drawings'}`;
          options.onPrompt(prompt);
        }
      })
      .catch(() => {});
  };
  async function load() {
    if (disposed || loading || (started && !cursor)) return;
    loading = true;
    const run = generation;
    status.textContent = 'Looking along the wall…';
    more.disabled = true;
    const query = new URLSearchParams({ sort, bucket: String(bucket) });
    if (options.wall) query.set('wall', String(options.wall));
    if (cursor) query.set('cursor', cursor);
    try {
      const page = await api<Page<Submission>>(
        `/api/prompts/${encodeURIComponent(slug)}/submissions?${query}`,
      );
      if (disposed || run !== generation) return;
      for (const item of page.items)
        if (!seen.has(item.id)) {
          items.push(item);
          seen.add(item.id);
        }
      cursor = page.next_cursor;
      started = true;
      render();
      status.textContent = items.length
        ? ''
        : 'Be the first to interpret this instruction.';
      more.hidden = !cursor;
    } catch (error) {
      if (disposed || run !== generation) return;
      status.textContent = (error as Error).message;
      more.hidden = false;
    } finally {
      if (run === generation) {
        loading = false;
        more.disabled = false;
      }
    }
  }
  const reset = () => {
    generation++;
    loading = false;
    cursor = null;
    started = false;
    items.splice(
      0,
      items.length,
      ...items.filter((item) => item.id === options.mine),
    );
    seen.clear();
    for (const item of items) seen.add(item.id);
    render();
    void load();
  };
  order.addEventListener('change', () => {
    sort = order.value;
    const query = new URLSearchParams(location.search);
    query.set('sort', sort);
    history.replaceState(null, '', `${location.pathname}?${query}`);
    reset();
  });
  tools.append(
    order,
    button('↝ Shuffle again', () => {
      sort = 'random';
      order.value = sort;
      bucket = (bucket + 1 + Math.floor(Math.random() * 63)) % 64;
      const query = new URLSearchParams(location.search);
      query.set('sort', sort);
      history.replaceState(null, '', `${location.pathname}?${query}`);
      reset();
    }),
  );
  const featured = element('section', 'featured-drawing');
  if (options.featured) {
    featured.setAttribute('aria-label', 'Selected drawing');
    featured.append(element('p', 'muted', 'Loading the drawing…'));
    void api<Submission>(`/api/submissions/${options.featured}`)
      .then((item) => {
        if (disposed) return;
        if (
          item.prompt_slug !== slug ||
          item.wall !== (options.wall ?? options.currentWall)
        )
          throw new Error('That drawing belongs to another instruction.');
        const open = button('', () => lightbox.open(item), 'featured-art');
        open.setAttribute('aria-label', `Open Drawing ${item.number} details`);
        open.style.background = item.background;
        const image = element('img');
        image.src = item.full_url;
        image.width = image.height = 1000;
        image.alt = `Drawing ${item.number} by ${item.display_name ?? 'an anonymous artist'}`;
        open.append(image);
        featured.replaceChildren(
          open,
          element(
            'p',
            'placard',
            `Wall ${item.wall} · Drawing #${item.number} — ${item.display_name ?? 'anonymous'} · ${relativeTime(item.created_at)}`,
          ),
        );
      })
      .catch((error) => {
        if (!disposed)
          featured.replaceChildren(
            element('p', 'muted', (error as Error).message),
          );
      });
  }
  root.append(
    ...(options.featured ? [featured] : []),
    heading,
    description,
    meta,
    tools,
    grid,
    status,
    more,
    sentinel,
  );
  const query = options.wall ? `?wall=${options.wall}` : '';
  void api<PromptDetail>(`/api/prompts/${encodeURIComponent(slug)}${query}`)
    .then((prompt) => {
      if (disposed) return;
      heading.textContent = `Wall ${prompt.wall}`;
      description.textContent = prompt.text;
      description.classList.toggle('long', prompt.text.length > 140);
      options.onPrompt(prompt);
      meta.textContent = `${prompt.count} ${prompt.count === 1 ? 'drawing' : 'drawings'}`;
      if (options.wall) {
        meta.append(
          document.createTextNode(' · This wall is closed. '),
          link('Explore this wall', `/w/${options.wall}`),
        );
      } else if (prompt.accepting && prompt.active)
        tools.append(
          link('Draw this one →', `/draw/${slug}`, 'button primary'),
        );
    })
    .catch((error) => {
      if (!disposed) description.textContent = error.message;
    });
  if (options.mine && options.mine !== 'pending')
    void api<Submission>(`/api/submissions/${options.mine}`)
      .then((item) => {
        if (
          item.prompt_slug === slug &&
          item.wall === (options.wall ?? options.currentWall)
        )
          setMine(item);
        else {
          pending = false;
          render();
        }
      })
      .catch(() => {
        if (!disposed) {
          pending = false;
          render();
          status.textContent = 'Your drawing could not be found.';
        }
      });
  if (location.hash)
    void api<Submission>(
      `/api/submissions/${encodeURIComponent(location.hash.slice(1))}`,
    )
      .then((item) => {
        if (
          !disposed &&
          item.prompt_slug === slug &&
          item.wall === (options.wall ?? options.currentWall)
        )
          lightbox.open(item);
      })
      .catch((error) => {
        if (!disposed) status.textContent = error.message;
      });
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load();
    },
    { rootMargin: '1200px' },
  );
  observer.observe(sentinel);
  let frame = 0;
  const scroll = () => {
    if (items.length > 600 && !frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        render();
      });
  };
  window.addEventListener('scroll', scroll, { passive: true });
  void load();
  return {
    slot,
    setMine,
    destroy: () => {
      disposed = true;
      observer.disconnect();
      lightbox.destroy();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll);
    },
  };
}
