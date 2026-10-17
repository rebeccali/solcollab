import type { Drawing, Submission } from '@solcollab/shared';
import { ReplayPlayer } from '../replay/player';
import { api, button, element, relativeTime } from '../ui/dom';

export class Lightbox {
  private dialog = element('dialog', 'lightbox');
  private player: ReplayPlayer | undefined;
  private current: Submission | undefined;
  private token = 0;
  constructor(private readonly items: () => Submission[]) {
    document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => {
      this.player?.destroy();
      this.token++;
      if (location.hash)
        history.replaceState(
          null,
          '',
          `${location.pathname}${location.search}`,
        );
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.dialog.close();
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.step(1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.step(-1);
      }
    });
  }
  private step(direction: number) {
    const items = this.items(),
      index = items.findIndex((item) => item.id === this.current?.id),
      next = items[index + direction];
    if (next) this.open(next);
  }
  open(item: Submission) {
    this.token++;
    this.player?.destroy();
    this.player = undefined;
    this.current = item;
    this.dialog.replaceChildren();
    this.dialog.setAttribute(
      'aria-label',
      `Wall ${item.wall}, Drawing ${item.number}`,
    );
    const close = button(
      'Close ×',
      () => this.dialog.close(),
      'button close-lightbox',
    );
    const image = element('img', 'full-drawing');
    image.src = item.full_url;
    image.width = image.height = 1000;
    image.alt = `Drawing ${item.number} by ${item.display_name ?? 'an anonymous artist'}`;
    const artwork = element('div', 'lightbox-artwork');
    artwork.append(image);
    const caption = element(
      'p',
      'placard',
      `Wall ${item.wall} · Drawing #${item.number} — ${item.display_name ?? 'anonymous'} · ${relativeTime(item.created_at)}`,
    );
    const controls = element('div', 'lightbox-controls');
    const previous = button('← Previous', () => this.step(-1)),
      next = button('Next →', () => this.step(1));
    const index = this.items().findIndex((p) => p.id === item.id);
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index >= this.items().length - 1;
    controls.append(previous, next);
    if (item.strokes_url) {
      const replay = button('▶ Replay · 5 seconds', () => {
        void play();
      });
      const play = async () => {
        const token = this.token;
        replay.disabled = true;
        try {
          const drawing = await api<Drawing>(item.strokes_url!);
          if (token !== this.token || !this.dialog.open) return;
          this.player?.destroy();
          this.player = new ReplayPlayer(drawing);
          artwork.replaceChildren(this.player.node);
          replay.textContent = 'Restart replay';
        } catch (error) {
          caption.textContent = (error as Error).message;
        } finally {
          if (token === this.token) replay.disabled = false;
        }
      };
      controls.append(replay);
    }
    const report = button('Report', () => {
      notice.textContent =
        'Reporting opens with the moderation tools. For now, contact the operator using the About page.';
    });
    const notice = element('p', 'muted');
    notice.setAttribute('role', 'status');
    const share = button('Copy link', () => {
      void navigator.clipboard
        ?.writeText(location.href)
        .then(() => {
          notice.textContent = 'Link copied.';
        })
        .catch(() => {
          notice.textContent = location.href;
        });
    });
    controls.append(share, report);
    this.dialog.append(close, artwork, caption, controls, notice);
    history.replaceState(
      null,
      '',
      `${location.pathname}${location.search}#${item.id}`,
    );
    if (!this.dialog.open) this.dialog.showModal();
    close.focus();
  }
  destroy() {
    this.player?.destroy();
    this.dialog.remove();
  }
}
