if (window.Quill && !window.Quill.imports['formats/displayCallout']) {
  const Block = window.Quill.import('blots/block');

  class DisplayCalloutBlot extends Block {
    static blotName = 'displayCallout';
    static tagName = 'div';
    static className = 'display-callout';
  }

  window.Quill.register(DisplayCalloutBlot, true);
}

class RichTextWidget {
  constructor() {
    this.pendingContent = '';
    this.isDisplayMode = false;
    const appModeUtils = window.TeacherScreenAppMode || {};
    this.isProjectorMode = appModeUtils.isProjectorMode || (() => (
      window.APP_MODE === 'projector'
      || document.body?.classList.contains('projector-view')
    ));
    this.element = document.createElement('div');
    this.element.className = 'rich-text-widget-inner';
    this.element.classList.toggle('is-projector-mode', this.isProjectorMode());

    this.handleDisplayModeClick = this.handleDisplayModeClick.bind(this);
    this.handleTextChange = this.handleTextChange.bind(this);

    this.controlsOverlay = document.createElement('div');
    this.controlsOverlay.className = 'widget-content-controls rich-text-settings-controls';

    this.displayModeButton = document.createElement('button');
    this.displayModeButton.className = 'control-button';
    this.displayModeButton.type = 'button';
    this.displayModeButton.textContent = 'Display';
    this.displayModeButton.setAttribute('aria-pressed', 'false');
    this.displayModeButton.title = 'Toggle display mode';
    this.displayModeButton.addEventListener('click', this.handleDisplayModeClick);

    this.controlsOverlay.appendChild(this.displayModeButton);
    this.updateDisplayModeUI();

    this.dragHandle = document.createElement('div');
    this.dragHandle.className = 'rich-text-drag-handle';
    this.dragHandle.textContent = 'Drag to move';
    this.dragHandle.setAttribute('role', 'presentation');

    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'rich-text-editor-container';
    this.editorContainer.style.height = '100%';

    this.element.appendChild(this.dragHandle);
    this.element.appendChild(this.editorContainer);

    this.initTimer = setTimeout(() => {
      const SizeStyle = Quill.import('attributors/style/size');
      SizeStyle.whitelist = ['small', 'large', 'huge'];
      Quill.register(SizeStyle, true);

      const ColorStyle = Quill.import('attributors/style/color');
      Quill.register(ColorStyle, true);

      const BackgroundStyle = Quill.import('attributors/style/background');
      Quill.register(BackgroundStyle, true);

      const toolbarOptions = [
        [{ header: [2, 3, false] }],
        [{ size: ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline'],
        ['link'],
        [{ color: [] }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['clean']
      ];

      this.quill = new Quill(this.editorContainer, {
        theme: 'snow',
        modules: {
          toolbar: {
            container: toolbarOptions
          }
        }
      });

      if (this.pendingContent) {
        this.quill.root.innerHTML = this.pendingContent;
      }

      this.quill.on('text-change', this.handleTextChange);
      this.updateDisplayModeUI();
    }, 0);
  }

  getControls() {
    return this.controlsOverlay;
  }

  handleDisplayModeClick() {
    this.isDisplayMode = !this.isDisplayMode;
    this.element.classList.toggle('display-mode', this.isDisplayMode);
    this.updateDisplayModeUI();
  }

  handleTextChange() {
    if (!this.quill) {
      return;
    }

    this.pendingContent = this.quill.root.innerHTML;
    document.dispatchEvent(new CustomEvent('widgetChanged', { detail: { widget: this } }));
  }

  insertHtml(html) {
    if (!this.quill) {
      return;
    }

    const range = this.quill.getSelection(true);
    const insertIndex = range ? range.index : this.quill.getLength();
    this.quill.clipboard.dangerouslyPasteHTML(insertIndex, html);
    this.quill.setSelection(insertIndex + 1, 0);
  }

  serialize() {
    return {
      content: this.quill ? this.quill.root.innerHTML : this.pendingContent,
      displayMode: this.isDisplayMode
    };
  }

  deserialize(data) {
    this.pendingContent = data?.content || '';
    this.isDisplayMode = data?.displayMode === true;
    this.element.classList.toggle('display-mode', this.isDisplayMode);
    this.element.classList.toggle('is-projector-mode', this.isProjectorMode());
    this.updateDisplayModeUI();

    if (this.quill) {
      this.quill.root.innerHTML = this.pendingContent;
    }
  }

  updateDisplayModeUI() {
    this.element.classList.toggle('is-projector-mode', this.isProjectorMode());
    this.displayModeButton.textContent = this.isDisplayMode ? 'Edit' : 'Display';
    this.displayModeButton.setAttribute('aria-pressed', this.isDisplayMode ? 'true' : 'false');

    if (this.quill) {
      this.quill.enable(!this.isProjectorMode());
    }
  }

  remove() {
    this.displayModeButton.removeEventListener('click', this.handleDisplayModeClick);

    if (this.initTimer) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }

    if (this.quill && typeof this.quill.off === 'function') {
      this.quill.off('text-change', this.handleTextChange);
    }

    this.quill = null;
    this.element.remove();

    const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
    document.dispatchEvent(event);
  }
}
