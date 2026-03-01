class RichTextWidget {
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'rich-text-widget-inner';

    this.editorContainer = document.createElement('div');
    this.editorContainer.style.height = '100%';

    this.element.appendChild(this.editorContainer);

    setTimeout(() => {
      this.quill = new Quill(this.editorContainer, {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['clean']
          ]
        }
      });

      this.load();
      this.quill.on('text-change', () => this.save());
    }, 0);
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
    localStorage.setItem('richTextWidgetContent', this.quill.root.innerHTML);
  }

  load() {
    const saved = localStorage.getItem('richTextWidgetContent');
    if (saved && this.quill) {
      this.quill.root.innerHTML = saved;
    }
  }
}
