import type {
  Page,
  Prompt,
  PromptDetail,
  PublicConfig,
  Submission,
  Wall,
} from '@solcollab/shared';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './style.css';
import { Editor } from './canvas/editor';
import { toolbar } from './canvas/toolbar';
import { galleryView, type GalleryView } from './gallery/view';
import { animateSubmission } from './shatter/engine';
import {
  api,
  button,
  completed,
  element,
  field,
  input,
  link,
  storedSlugs,
} from './ui/dom';

const app = document.querySelector<HTMLDivElement>('#app')!;
let config: PublicConfig;
let cleanup = () => {};
let routeNumber = 0;
let activeEditor: Editor | undefined;
let gallery: GalleryView | undefined;
let submitting = false;
let pendingPreview: string | undefined;
let pendingDrawError = '';
let cancelSubmission: (() => void) | undefined;

async function newPrompt() {
  if (submitting) return;
  try {
    const exclude = storedSlugs();
    if (activeEditor) exclude.unshift(activeEditor.slug);
    const prompt = await api<Prompt>(
      `/api/prompt/random?exclude=${encodeURIComponent(exclude.slice(0, 50).join(','))}`,
    );
    navigate(`/draw/${prompt.slug}`);
  } catch (error) {
    announce((error as Error).message);
  }
}
function announce(message: string) {
  document.querySelector('#announcer')!.textContent = message;
}
function navigate(path: string) {
  history.pushState(null, '', path);
  render();
  document.querySelector('main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function shell() {
  const layout = element('div', 'layout'),
    sidebar = element('aside', 'sidebar');
  const brand = link('', '/', 'wordmark');
  const mark = element('span', 'brand-mark');
  mark.setAttribute('aria-hidden', 'true');
  brand.append(mark, element('span', 'brand-name', 'Solcollab'));
  const tag = element(
    'p',
    'brand-note',
    'One prompt.\nMany hands.\nOne gallery wall.',
  );
  const nav = element('nav', 'primary-nav');
  nav.setAttribute('aria-label', 'Main navigation');
  nav.append(
    button(
      'New prompt →',
      () => {
        void newPrompt();
      },
      'button primary',
    ),
    link('Explore prompts', '/prompts', 'button'),
  );
  const footer = element('div', 'sidebar-footer');
  footer.append(
    element('p', 'wall-label', config.current_wall.title),
    link('Past walls', '/walls'),
    link('About & privacy', '/about'),
  );
  sidebar.append(brand, tag, nav, footer);
  if (location.pathname.startsWith('/draw/')) {
    const toggle = button(
      '↤',
      () => {
        const collapsed = layout.classList.toggle('sidebar-collapsed');
        toggle.textContent = collapsed ? '↦' : '↤';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute(
          'aria-label',
          collapsed ? 'Expand sidebar' : 'Collapse sidebar',
        );
      },
      'button sidebar-toggle',
    );
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Collapse sidebar');
    sidebar.append(toggle);
  }
  const main = element('main', 'main-content');
  main.id = 'main';
  main.tabIndex = -1;
  const skip = link('Skip to content', '#main', 'skip-link');
  if (config.banner_message)
    main.append(element('p', 'banner', config.banner_message));
  layout.append(sidebar, main);
  app.replaceChildren(skip, layout);
  return main;
}

function render() {
  cleanup();
  cleanup = () => {};
  activeEditor = undefined;
  gallery = undefined;
  const token = ++routeNumber,
    root = shell(),
    path = location.pathname;
  document.body.classList.toggle('draw-page', path.startsWith('/draw/'));
  document.title = 'Solcollab — one prompt, many hands';
  let match = /^\/draw\/([^/]+)$/.exec(path);
  if (match) {
    void drawPage(root, decodeURIComponent(match[1]!), token);
    return;
  }
  match = /^\/(?:w\/(\d+)\/)?p\/([^/]+)$/.exec(path);
  if (match) {
    const mine = new URLSearchParams(location.search).get('mine');
    gallery = galleryView(root, decodeURIComponent(match[2]!), {
      currentWall: config.current_wall.id,
      ...(match[1] ? { wall: +match[1] } : {}),
      ...(mine ? { mine } : {}),
      ...(mine === 'pending' && pendingPreview
        ? { localUrl: pendingPreview }
        : {}),
      onNavigate: navigate,
    });
    cleanup = gallery.destroy;
    return;
  }
  match = /^\/w\/(\d+)$/.exec(path);
  if (path === '/prompts' || match) {
    explore(root, match ? +match[1]! : undefined);
    return;
  }
  if (path === '/walls') {
    void walls(root, token);
    return;
  }
  if (path === '/about') {
    about(root);
    return;
  }
  if (import.meta.env.DEV && path === '/dev/shatter') {
    void import('./shatter/harness').then((module) => {
      if (token === routeNumber) cleanup = module.harness(root);
    });
    return;
  }
  if (path === '/') {
    void newPrompt();
    return;
  }
  root.append(
    element('h1', 'page-title', 'That page is not on this wall.'),
    link('Find an instruction →', '/', 'button'),
  );
}

async function drawPage(root: HTMLElement, slug: string, token: number) {
  const loading = element('p', 'muted', 'Unfolding the instruction…');
  root.append(loading);
  try {
    const prompt = await api<PromptDetail>(
      `/api/prompts/${encodeURIComponent(slug)}`,
    );
    if (token !== routeNumber) return;
    loading.remove();
    document.title = `${prompt.text} — Solcollab`;
    const header = element('header', 'draw-header');
    header.append(
      element(
        'p',
        'eyebrow',
        `${config.current_wall.title} / your instruction`,
      ),
      element('h1', 'draw-instruction', prompt.text),
    );
    root.append(header);
    if (!config.submissions_open || !prompt.active || !prompt.accepting) {
      root.append(
        element(
          'p',
          'banner',
          'The wall is closed for new drawings. Browse the gallery while it rests.',
        ),
        link('Browse drawings →', `/p/${slug}`, 'button'),
      );
      return;
    }
    const workspace = element('div', 'workspace'),
      stage = element('div');
    const editor = new Editor(stage, slug);
    activeEditor = editor;
    const tools = toolbar(editor),
      status = element('p', 'editor-status');
    status.setAttribute('role', 'status');
    const name = input('text', 'Sign it (optional)', '');
    name.maxLength = 32;
    name.setAttribute('autocomplete', 'nickname');
    name.placeholder = 'Your name, if you like';
    const submit = button(
      'Hang on the wall →',
      () => {
        void submitDrawing();
      },
      'button primary submit',
    );
    const actions = element('div', 'draw-actions');
    actions.append(field('Sign it (optional)', name), submit);
    const hint = element(
      'p',
      'canvas-hint',
      '[ / ] brush size · ⌘/Ctrl Z undo · Keyboard canvas: arrows + Space',
    );
    const update = () => {
      tools.update();
      submit.disabled = !editor.hasMarks || submitting;
    };
    editor.onChange = update;
    editor.onMessage = (message) => {
      status.textContent = message;
    };
    workspace.append(tools.node, stage, hint, actions, status);
    root.append(workspace);
    let fitFrame = 0;
    const fit = () => {
      stage.style.width = '';
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => {
        const rect = stage.getBoundingClientRect();
        const below = root.getBoundingClientRect().bottom - rect.bottom;
        const available = Math.max(120, innerHeight - rect.top - below - 2);
        stage.style.width = `min(100%, ${available}px)`;
      });
    };
    const layoutObserver = new ResizeObserver(fit);
    layoutObserver.observe(header);
    layoutObserver.observe(tools.node);
    layoutObserver.observe(status);
    window.addEventListener('resize', fit);
    fit();
    if (pendingDrawError) {
      status.textContent = pendingDrawError;
      pendingDrawError = '';
    }
    update();
    cleanup = () => {
      cancelAnimationFrame(fitFrame);
      layoutObserver.disconnect();
      window.removeEventListener('resize', fit);
      editor.destroy();
    };
    async function submitDrawing() {
      editor.finishKeyboard();
      if (!editor.hasMarks || submitting) return;
      submitting = true;
      editor.frozen = true;
      update();
      status.textContent = 'Preparing your drawing…';
      let localUrl: string | undefined;
      let moved = false;
      let interrupted = false;
      try {
        const snapshot = editor.snapshot();
        const sourceRect = editor.ink.getBoundingClientRect();
        const image = await new Promise<Blob>((resolve, reject) =>
          snapshot.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(new Error('The drawing could not be exported.')),
            'image/png',
          ),
        );
        const body = new FormData();
        body.set('prompt_slug', slug);
        body.set('image', image, 'drawing.png');
        body.set('background', editor.state.background);
        body.set('display_name', name.value);
        body.set('input_type', editor.inputType);
        if (config.store_strokes) {
          const bytes = new Blob([JSON.stringify(editor.state)])
            .stream()
            .pipeThrough(new CompressionStream('gzip'));
          body.set(
            'strokes',
            await new Response(bytes).blob(),
            'strokes.json.gz',
          );
        }
        status.textContent = 'Finding a place on the wall…';
        const controller = new AbortController();
        cancelSubmission = () => {
          interrupted = true;
          controller.abort();
        };
        const upload = api<Submission>('/api/submissions', {
          method: 'POST',
          body,
          signal: controller.signal,
        });
        localUrl = URL.createObjectURL(image);
        pendingPreview = localUrl;
        await animateSubmission({
          snapshot,
          ink: editor.ink,
          sourceRect,
          upload,
          signal: controller.signal,
          onGallery: () => {
            moved = true;
            navigate(`/p/${slug}?mine=pending`);
            gallery?.slot.classList.add('awaiting-hang');
          },
          destination: () =>
            gallery?.slot.getBoundingClientRect() ?? sourceRect,
          onTimeout: () => controller.abort(),
          onHang: (result) => {
            editor.saved();
            completed(slug);
            gallery?.setMine(result);
            gallery?.slot.classList.remove('awaiting-hang');
            history.replaceState(null, '', `/p/${slug}?mine=${result.id}`);
            const message = `${config.current_wall.title} · Drawing #${result.number} — by you`;
            const placard = element('p', 'hang-placard', message);
            document.body.append(placard);
            setTimeout(() => placard.remove(), 4000);
            announce(
              `Your drawing was added to ${config.current_wall.title} as Drawing #${result.number}.`,
            );
          },
        });
      } catch (error) {
        const message = (error as Error).message;
        if (moved && !interrupted) {
          pendingDrawError = message;
          navigate(`/draw/${slug}`);
        } else status.textContent = message;
        announce(message);
      } finally {
        submitting = false;
        cancelSubmission = undefined;
        pendingPreview = undefined;
        if (localUrl) URL.revokeObjectURL(localUrl);
        editor.frozen = false;
        update();
        activeEditor?.onChange();
      }
    }
  } catch (error) {
    if (token === routeNumber) loading.textContent = (error as Error).message;
  }
}

function mosaic(urls: string[]) {
  const node = element('div', 'mini-mosaic');
  for (let i = 0; i < 4; i++) {
    if (urls[i]) {
      const image = element('img');
      image.src = urls[i]!;
      image.alt = '';
      image.width = image.height = 160;
      image.loading = 'lazy';
      node.append(image);
    } else node.append(element('span'));
  }
  return node;
}
function explore(root: HTMLElement, wall?: number) {
  let disposed = false,
    loading = false,
    cursor: string | null = null,
    started = false,
    sort = 'active',
    generation = 0;
  const heading = element(
    'h1',
    'page-title',
    wall ? `Explore Wall ${wall}` : 'An instruction for everyone.',
  );
  const intro = element(
    'p',
    'page-intro',
    wall
      ? 'This wall is closed. Its interpretations are here to stay.'
      : 'Same words. A different world in every pair of hands.',
  );
  const select = element('select');
  select.setAttribute('aria-label', 'Prompt order');
  for (const [value, text] of [
    ['active', 'Most active'],
    ['new', 'Newest instructions'],
  ]) {
    const option = element('option', '', text);
    option.value = value!;
    select.append(option);
  }
  const grid = element('div', 'prompt-grid'),
    status = element('p', 'muted'),
    sentinel = element('div', 'scroll-sentinel');
  const more = button('Load more instructions', () => {
    void load();
  });
  root.append(heading, intro, select, grid, status, more, sentinel);
  const load = async () => {
    if (disposed || loading || (started && !cursor)) return;
    loading = true;
    const run = generation;
    const query = new URLSearchParams({ sort });
    if (wall) query.set('wall', String(wall));
    if (cursor) query.set('cursor', cursor);
    try {
      const page = await api<Page<PromptDetail>>(`/api/prompts?${query}`);
      if (disposed || run !== generation) return;
      for (const prompt of page.items) {
        const card = link(
          '',
          wall ? `/w/${wall}/p/${prompt.slug}` : `/p/${prompt.slug}`,
          'prompt-card',
        );
        card.append(
          mosaic(prompt.thumbs),
          element('h2', '', prompt.text),
          element(
            'p',
            'muted',
            `${prompt.count} ${prompt.count === 1 ? 'drawing' : 'drawings'}`,
          ),
        );
        grid.append(card);
      }
      cursor = page.next_cursor;
      started = true;
      more.hidden = !cursor;
      status.textContent = grid.childElementCount
        ? ''
        : 'No instructions on this wall yet.';
    } catch (error) {
      if (!disposed) status.textContent = (error as Error).message;
    } finally {
      loading = false;
    }
  };
  select.addEventListener('change', () => {
    sort = select.value;
    generation++;
    loading = false;
    cursor = null;
    started = false;
    grid.replaceChildren();
    void load();
  });
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load();
    },
    { rootMargin: '1000px' },
  );
  observer.observe(sentinel);
  cleanup = () => {
    disposed = true;
    observer.disconnect();
  };
  void load();
}
async function walls(root: HTMLElement, token: number) {
  root.append(
    element('h1', 'page-title', 'Walls, past and present.'),
    element(
      'p',
      'page-intro',
      'A fresh wall begins. The old ones keep their stories.',
    ),
  );
  try {
    const page = await api<Page<Wall>>('/api/walls');
    if (token !== routeNumber) return;
    const grid = element('div', 'prompt-grid');
    for (const wall of page.items) {
      const card = link(
        '',
        wall.closed_at ? `/w/${wall.id}` : '/prompts',
        'prompt-card',
      );
      card.append(
        mosaic(wall.thumbs),
        element('h2', '', wall.title),
        element(
          'p',
          'muted',
          `${new Date(wall.opened_at).toLocaleDateString()} – ${wall.closed_at ? new Date(wall.closed_at).toLocaleDateString() : 'now'} · ${wall.count} drawings`,
        ),
      );
      grid.append(card);
    }
    root.append(grid);
  } catch (error) {
    if (token === routeNumber)
      root.append(element('p', 'banner', (error as Error).message));
  }
}
function about(root: HTMLElement) {
  root.classList.add('prose');
  root.append(
    element('p', 'eyebrow', 'About the wall'),
    element('h1', 'page-title', 'One instruction. Many interpretations.'),
    element(
      'p',
      '',
      'Solcollab takes its cue from Sol LeWitt’s wall drawings: an instruction can be a work of art, and the people who carry it out become part of the work. Here, a short prompt is your starting point. Every drawing is made by a person. There are no scores, rankings, or AI-generated drawings.',
    ),
    element('h2', '', 'A public wall, a light footprint.'),
    element(
      'p',
      '',
      'Drawings and optional signatures are public. You do not need an account. This local preview uses an anonymous browser cookie and daily-changing hashes of network addresses to support future abuse controls. Raw addresses are not stored by the app. Drafts stay in this tab’s browser storage until you submit; completed prompt hints stay in local storage. There are no third-party trackers. Optional stroke recordings let other visitors replay your drawing in five seconds.',
    ),
    element('h2', '', 'A new wall does not erase the old one.'),
    element(
      'p',
      '',
      'Closed walls remain browsable. Their drawings stay together, but no new drawings can be added to them.',
    ),
    element('h2', '', 'Contact & takedowns'),
    element(
      'p',
      '',
      'This is a local preview. Contact the person who shared this instance to request removal of a drawing. A public contact address will be published here before the wall opens online.',
    ),
    link('Find an instruction →', '/', 'button primary'),
  );
}

document.addEventListener('click', (event) => {
  const anchor = (event.target as Element).closest?.('a');
  if (
    !anchor ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    anchor.target ||
    anchor.hasAttribute('download')
  )
    return;
  const url = new URL(anchor.href);
  if (
    url.origin !== location.origin ||
    (url.pathname === location.pathname && url.hash)
  )
    return;
  if (submitting) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  if (url.pathname === '/') {
    void newPrompt();
    return;
  }
  navigate(url.pathname + url.search + url.hash);
});
window.addEventListener('popstate', () => {
  cancelSubmission?.();
  render();
});
void api<PublicConfig>('/api/config')
  .then((value) => {
    config = value;
    render();
  })
  .catch((error) => {
    app.replaceChildren(
      element('h1', 'page-title', 'The wall is resting.'),
      element('p', '', error.message),
      button('Try again', () => location.reload()),
    );
  });
