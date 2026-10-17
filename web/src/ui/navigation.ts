import createArtwork from './create.svg?raw';
import { button, element, link } from './dom';

export function navigation(onCreate: () => void, wallTitle: string) {
  const bar = element('footer', 'bottom-bar');
  const brand = link('Solcollab', '/', 'wordmark');
  const create = button('', onCreate, 'create-button');
  create.setAttribute('aria-label', 'create');
  // Static, repository-owned SVG; no user-supplied markup enters this button.
  create.innerHTML = createArtwork;
  const menu = element('nav', 'site-menu');
  menu.id = 'site-menu';
  menu.setAttribute('popover', 'auto');
  menu.setAttribute('aria-label', 'Site navigation');
  menu.append(
    link('Explore prompts', '/prompts'),
    link('Past walls', '/walls'),
    link('About & privacy', '/about'),
  );
  const context = element('section', 'navigation-context');
  menu.append(context, element('p', 'wall-label', wallTitle));
  const toggle = button('', () => {}, 'menu-toggle');
  toggle.setAttribute('aria-label', 'Menu');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', menu.id);
  toggle.setAttribute('popovertarget', menu.id);
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 6h18M3 12h18M3 18h18');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  icon.append(path);
  toggle.append(icon);
  menu.addEventListener('beforetoggle', (event) =>
    toggle.setAttribute(
      'aria-expanded',
      String((event as ToggleEvent).newState === 'open'),
    ),
  );
  bar.append(brand, create, toggle, menu);
  return bar;
}
