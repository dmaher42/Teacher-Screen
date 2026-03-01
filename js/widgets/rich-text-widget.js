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
    this.element = document.createElement('div');
    this.element.className = 'rich-text-widget-inner';

    this.controls = document.createElement('div');
    this.controls.className = 'rich-text-controls';

    this.displayModeButton = document.createElement('button');
    this.displayModeButton.id = 'toggle-display-mode';
    this.displayModeButton.className = 'control-button';
    this.displayModeButton.type = 'button';
    this.displayModeButton.textContent = '⚡ Display Mode';
    this.displayModeButton.addEventListener('click', () => {
      this.element.classList.toggle('display-mode');
    });

    this.controls.appendChild(this.displayModeButton);

    this.element.appendChild(this.controls);

    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'rich-text-editor-container';
    this.editorContainer.style.height = '100%';

    this.element.appendChild(this.editorContainer);

    setTimeout(() => {
      const SizeStyle = Quill.import('attributors/style/size');
      SizeStyle.whitelist = ['small', 'large', 'huge'];
      Quill.register(SizeStyle, true);

      const BackgroundStyle = Quill.import('attributors/style/background');
      BackgroundStyle.whitelist = ['#fff3bf', '#c8f7c5', '#bee3f8', '#ffd6e7'];
      Quill.register(BackgroundStyle, true);

      const toolbarOptions = [
        [{ header: [2, 3, false] }],
        [{ size: ['small', false, 'large', 'huge'] }],
        ['bold'],
        [{ background: [] }],
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

      this.load();
      this.quill.on('text-change', () => this.save());
    }, 0);
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
      content: this.quill ? this.quill.root.innerHTML : ''
    };
  }

  deserialize(data) {
    if (this.quill && data?.content) {
      this.quill.root.innerHTML = data.content;
    }
  }

  save() {
    if (this.quill) {
      localStorage.setItem('richTextWidgetContent', this.quill.root.innerHTML);
    }
  }

  load() {
    const saved = localStorage.getItem('richTextWidgetContent');
    if (saved && this.quill) {
      this.quill.root.innerHTML = saved;
    }
  }
}
