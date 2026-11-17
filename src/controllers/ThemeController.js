export class ThemeController {
  constructor({ model, view }) {
    view.render(model.mode);
    view.bindToggle(() => model.cycle());
    model.on('change', (mode) => view.render(mode));
  }
}
