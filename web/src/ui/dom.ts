export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function link(text: string, href: string, className = '') {
  const node = element('a', className, text);
  node.href = href;
  return node;
}
export function button(text: string, action: () => void, className = 'button') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
export function field(label: string, input: HTMLElement) {
  const node = element('label', 'field');
  node.append(element('span', 'field-label', label), input);
  return node;
}
export function input(type: string, label: string, value: string) {
  const node = element('input');
  node.type = type;
  node.value = value;
  node.setAttribute('aria-label', label);
  return node;
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      message = (await response.json()).error ?? message;
    } catch {
      /* Non-JSON proxy failures. */
    }
    if (response.status === 429)
      message += ` Try again in ${response.headers.get('Retry-After') ?? 'a few'} seconds.`;
    throw new Error(message);
  }
  return response.json();
}
export function storedSlugs() {
  try {
    return JSON.parse(
      localStorage.getItem('solcollab:completed') ?? '[]',
    ) as string[];
  } catch {
    return [];
  }
}
export function completed(slug: string) {
  try {
    localStorage.setItem(
      'solcollab:completed',
      JSON.stringify(
        [slug, ...storedSlugs().filter((p) => p !== slug)].slice(0, 50),
      ),
    );
  } catch {
    /* Optional repeat hints. */
  }
}
export function relativeTime(time: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 1
    ? 'just now'
    : minutes < 60
      ? `${minutes} min ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)} h ago`
        : `${Math.floor(minutes / 1440)} d ago`;
}
