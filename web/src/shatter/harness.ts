export function harness(root: HTMLElement) {
  root.textContent = 'The animation harness is being assembled.';
  return () => {};
}
