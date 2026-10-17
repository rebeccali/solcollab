import { button, element, field, input } from '../ui/dom';
import { Editor } from './editor';

function iconButton(label: string, pathData: string, action: () => void) {
  const control = button('', action, 'button tool-icon');
  control.setAttribute('aria-label', label);
  control.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.append(path);
  control.append(svg);
  return control;
}

function cell(...children: HTMLElement[]) {
  const node = element('div', 'tool-cell');
  node.append(...children);
  return node;
}

export function toolbar(editor: Editor) {
  const bar = element('div', 'toolbar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Drawing tools');
  const palette = element('div', 'palette');
  const colors = [
    '#202020',
    '#D7261E',
    '#2358BD',
    '#F2C230',
    '#7B7871',
    '#FFFFFF',
  ];
  const color = input('color', 'Ink color', editor.color);
  for (const hex of colors) {
    const swatch = button(
      '',
      () => {
        editor.color = hex;
        color.value = hex;
        alphaFill.style.backgroundColor = hex;
      },
      'swatch',
    );
    swatch.style.backgroundColor = hex;
    swatch.setAttribute('aria-label', `Ink ${hex}`);
    palette.append(swatch);
  }
  color.addEventListener('input', () => {
    editor.color = color.value;
    alphaFill.style.backgroundColor = color.value;
  });
  const opacity = input('range', 'Opacity', '100');
  opacity.min = '0';
  opacity.max = '100';
  const alphaLabel = element('output', '', '100%');
  const alphaSwatch = element('span', 'alpha-swatch');
  const alphaFill = element('span');
  alphaSwatch.append(alphaFill);
  opacity.addEventListener('input', () => {
    editor.alpha = +opacity.value / 100;
    alphaLabel.value = `${opacity.value}%`;
    alphaFill.style.opacity = String(editor.alpha);
  });
  const size = input('range', 'Brush size', '12');
  size.min = '1';
  size.max = '80';
  const sizeLabel = element('output', '', '12 px');
  size.addEventListener('input', () => {
    editor.size = +size.value;
    sizeLabel.value = `${size.value} px`;
  });
  const eraser = iconButton(
    'Eraser',
    'M14 3 3 14l7 7h4L24 11 16 3ZM8 9l9 9M10 21h11',
    () => {
      editor.tool = editor.tool === 'pen' ? 'eraser' : 'pen';
      eraser.setAttribute('aria-pressed', String(editor.tool === 'eraser'));
    },
  );
  eraser.setAttribute('aria-pressed', 'false');
  const background = input(
    'color',
    'Background color',
    editor.state.background,
  );
  background.addEventListener('change', () =>
    editor.setBackground(background.value),
  );
  const undo = iconButton('Undo', 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14', () =>
      editor.undo(),
    ),
    redo = iconButton('Redo', 'm16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14', () =>
      editor.redo(),
    );
  const update = () => {
    undo.disabled = !editor.canUndo;
    redo.disabled = !editor.canRedo;
    size.value = String(editor.size);
    sizeLabel.value = `${editor.size} px`;
    background.value = editor.state.background;
  };
  bar.append(
    cell(palette),
    cell(field('Ink', color)),
    cell(field('Opacity', opacity), alphaLabel, alphaSwatch),
    cell(field('Brush', size), sizeLabel),
    cell(
      eraser,
      undo,
      redo,
      button('Clear', () => editor.clear()),
    ),
    cell(field('Paper', background)),
  );
  update();
  return { node: bar, update };
}
