import { button, element, input } from '../ui/dom';
import { Editor } from './editor';
import type { ShapeTool } from './shapes';

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

function cell(label: string, ...children: HTMLElement[]) {
  const node = element('div', 'tool-cell');
  const controls = element('div', 'tool-controls');
  controls.append(...children);
  if (label) node.append(element('span', 'field-label', label));
  node.append(controls);
  return node;
}

export function toolbar(
  editor: Editor,
  artist: HTMLInputElement,
  submit: HTMLButtonElement,
) {
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
  );
  undo.dataset.keepsShape = '';
  const shapes: [ShapeTool | 'fill' | null, string, string][] = [
    [
      null,
      'Brush (freehand)',
      'M20 4 10.5 13.5M10.5 13.5a3 3 0 0 0-4.2 0C4.8 15 5.5 18.5 3 19.5c3.5 1.5 7 .5 8-1a3 3 0 0 0-.5-5Z',
    ],
    [
      'fill',
      'Fill',
      'M5 11 12 4l7 7-7 7ZM5 11h14M20 15c0 1.5 1 2.5 1 3.5a1 1 0 0 1-2 0c0-1 1-2 1-3.5Z',
    ],
    ['line', 'Line', 'M5 19 19 5'],
    ['arc', '3-point arc', 'M3 17a9 9 0 0 1 18 0'],
    [
      'polygon',
      'Polygon (click the first point or off the canvas to close)',
      'M12 3.5 20.5 10l-3.2 10H6.7L3.5 10Z',
    ],
    [
      'circle',
      'Circle (center, then radius)',
      'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 12h.01',
    ],
  ];
  const shapeButtons = shapes.map(([shape, label, path]) => {
    const control = iconButton(label, path, () => {
      editor.setShape(editor.shape === shape ? null : shape);
      for (const other of shapeButtons)
        other.setAttribute(
          'aria-pressed',
          String(other.dataset.shape === (editor.shape ?? 'brush')),
        );
    });
    control.dataset.shape = shape ?? 'brush';
    control.setAttribute('aria-pressed', String(shape === null));
    return control;
  });
  const update = () => {
    undo.disabled = !editor.canUndo;
    size.value = String(editor.size);
    sizeLabel.value = `${editor.size} px`;
    background.value = editor.state.background;
  };
  const ink = cell('Ink', palette, color);
  ink.classList.add('ink-cell');
  const canvas = cell('Canvas', background);
  const opacityCell = cell('Opacity', opacity, alphaLabel, alphaSwatch);
  const brush = cell('Brush size', size, sizeLabel);
  const artistCell = cell('Artist (optional)', artist);
  for (const node of [canvas, opacityCell, brush, artistCell])
    node.classList.add('standard-cell');
  const shapeRow = shapeButtons.map((control) => {
    const node = cell('', control);
    node.classList.add('action-cell', 'shape-cell');
    return node;
  });
  const actions = [
    eraser,
    undo,
    button('Clear', () => editor.clear()),
    submit,
  ].map((control) => {
    const node = cell('', control);
    node.classList.add('action-cell');
    return node;
  });
  bar.append(
    ink,
    canvas,
    opacityCell,
    brush,
    artistCell,
    ...shapeRow,
    ...actions,
  );
  update();
  return { node: bar, update };
}
