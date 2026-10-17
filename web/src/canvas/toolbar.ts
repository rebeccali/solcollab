import { button, element, field, input } from '../ui/dom';
import { Editor } from './editor';

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
  const eraser = button('Eraser', () => {
    editor.tool = editor.tool === 'pen' ? 'eraser' : 'pen';
    eraser.setAttribute('aria-pressed', String(editor.tool === 'eraser'));
  });
  eraser.setAttribute('aria-pressed', 'false');
  const background = input(
    'color',
    'Background color',
    editor.state.background,
  );
  background.addEventListener('change', () =>
    editor.setBackground(background.value),
  );
  const undo = button('Undo', () => editor.undo()),
    redo = button('Redo', () => editor.redo());
  const update = () => {
    undo.disabled = !editor.canUndo;
    redo.disabled = !editor.canRedo;
    size.value = String(editor.size);
    sizeLabel.value = `${editor.size} px`;
    background.value = editor.state.background;
  };
  bar.append(
    palette,
    field('Ink', color),
    field('Opacity', opacity),
    alphaLabel,
    alphaSwatch,
    field('Brush', size),
    sizeLabel,
    eraser,
    undo,
    redo,
    button('Clear', () => editor.clear()),
    field('Paper', background),
  );
  update();
  return { node: bar, update };
}
