import type { RandomPromptResponse } from '@solcollab/shared';
import './style.css';

const heading = document.querySelector<HTMLHeadingElement>('#prompt')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const button = document.querySelector<HTMLButtonElement>('#new-prompt')!;
const storageKey = 'solcollab:last-preview-prompt';
let currentSlug = '';
try {
  currentSlug = sessionStorage.getItem(storageKey) ?? '';
} catch {
  // The page still works when browser storage is disabled.
}

async function showPrompt(): Promise<void> {
  button.disabled = true;
  status.textContent = '';
  try {
    const query = new URLSearchParams();
    if (currentSlug) query.set('exclude', currentSlug);
    const response = await fetch(`/api/prompt/random?${query}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Could not load a prompt.');
    const prompt: RandomPromptResponse = await response.json();
    heading.textContent = prompt.text;
    currentSlug = prompt.slug;
    try {
      sessionStorage.setItem(storageKey, currentSlug);
    } catch {
      // Exclusion still works for the next button click without storage.
    }
  } catch {
    status.textContent = 'The instructions are unavailable. Please try again.';
  } finally {
    button.disabled = false;
  }
}

button.addEventListener('click', () => void showPrompt());
void showPrompt();
