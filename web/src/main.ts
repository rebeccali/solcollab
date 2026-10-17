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
import { wallView } from './gallery/wall';
import { animateSubmission } from './shatter/engine';
import { navigation } from './ui/navigation';
import {
  api,
  button,
  completed,
  element,
  input,
  link,
  promptName,
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
  const layout = element('div', 'layout');
  const bar = navigation(() => {
    void newPrompt();
  }, config.current_wall.title);
  const main = element('main', 'main-content');
  main.id = 'main';
  main.tabIndex = -1;
  const skip = link('Skip to content', '#main', 'skip-link');
  if (config.banner_message)
    main.append(element('p', 'banner', config.banner_message));
  layout.append(main, bar);
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
  document.title = 'Solcollab';
  let match = /^\/draw\/([^/]+)$/.exec(path);
  if (match) {
    void drawPage(root, decodeURIComponent(match[1]!), token);
    return;
  }
  match = /^\/(?:w\/(\d+)\/)?p\/([^/]+)(?:\/([0-9A-HJKMNP-TV-Z]{26}))?$/.exec(
    path,
  );
  if (match) {
    const mine = new URLSearchParams(location.search).get('mine');
    gallery = galleryView(root, decodeURIComponent(match[2]!), {
      currentWall: config.current_wall.id,
      onPrompt: updateContext,
      ...(match[1] ? { wall: +match[1] } : {}),
      ...(match[3] ? { featured: match[3] } : {}),
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
    element('h1', 'page-title', 'Page not found'),
    link('Find an instruction →', '/', 'button'),
  );
}

async function drawPage(root: HTMLElement, slug: string, token: number) {
  const loading = element('p', 'muted', 'Loading instruction…');
  root.append(loading);
  try {
    const prompt = await api<PromptDetail>(
      `/api/prompts/${encodeURIComponent(slug)}`,
    );
    if (token !== routeNumber) return;
    updateContext(prompt);
    loading.remove();
    document.title = `${prompt.text} — Solcollab`;
    const header = element('header', 'draw-header');
    header.append(
      element(
        'p',
        'eyebrow',
        `${config.current_wall.title} / your instruction`,
      ),
      element(
        'h1',
        `draw-instruction${prompt.text.length > 140 ? ' long' : ''}`,
        prompt.text,
      ),
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
    const status = element('p', 'editor-status');
    status.setAttribute('role', 'status');
    const name = input('text', 'Artist (optional)', '');
    name.maxLength = 32;
    name.setAttribute('autocomplete', 'nickname');
    name.placeholder = 'Anonymous';
    const submit = button(
      'Submit',
      () => {
        void submitDrawing();
      },
      'button primary submit',
    );
    const tools = toolbar(editor, name, submit);
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
    workspace.append(stage, tools.node, hint, status);
    root.append(workspace);
    let fitFrame = 0;
    const fit = () => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => {
        stage.style.width = '';
        const rect = stage.getBoundingClientRect();
        const below = root.getBoundingClientRect().bottom - rect.bottom;
        // Let the taller tool panel scroll rather than squeezing the drawing area.
        const minimum = Math.min(260, workspace.clientWidth);
        const available = Math.max(minimum, innerHeight - rect.top - below - 2);
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

function updateContext(prompt: PromptDetail) {
  const context = document.querySelector('.navigation-context');
  if (context)
    context.replaceChildren(
      element('p', 'context-instruction', prompt.text),
      element(
        'p',
        'muted',
        `${promptName(prompt.slug)} · ${prompt.count} ${prompt.count === 1 ? 'drawing' : 'drawings'}`,
      ),
    );
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
  // Keep the shuffle on Back so the wall reappears in the same order.
  const saved = (history.state as { seed?: unknown } | null)?.seed;
  const seed =
    typeof saved === 'number'
      ? saved
      : crypto.getRandomValues(new Uint32Array(1))[0]!;
  if (saved !== seed) history.replaceState({ seed }, '');
  cleanup = wallView(root, { seed, ...(wall ? { wall } : {}) });
}
async function walls(root: HTMLElement, token: number) {
  root.append(
    element('h1', 'page-title', 'Past walls'),
    element('p', 'page-intro', 'TODO: Write the walls introduction.'),
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
    element('h1', 'page-title', 'About'),
    element('p', '', 'TODO: Write the introduction and Sol LeWitt reference.'),
    element('p', '', 'TODO: Write the privacy and data-storage explanation.'),
    element('p', '', 'TODO: Write the explanation of archived walls.'),
    /* Contact email intentionally blank for now; keep this section hidden.
    element('h2', '', 'Contact & takedowns'),
    element(
      'p',
      '',
      'TODO: Add contact and takedown details when an email is supplied.',
    ),
    */
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
window.addEventListener('beforeunload', (event) => {
  if (submitting) {
    event.preventDefault();
    event.returnValue = '';
  }
});
void api<PublicConfig>('/api/config')
  .then((value) => {
    config = value;
    render();
  })
  .catch((error) => {
    app.replaceChildren(
      element('h1', 'page-title', 'Unable to load Solcollab'),
      element('p', '', error.message),
      button('Try again', () => location.reload()),
    );
  });
