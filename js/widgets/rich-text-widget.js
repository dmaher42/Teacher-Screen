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

    const templates = [
      {
        label: 'Insert Lesson Outline',
        html: `<h2>Learning Intention</h2>
<ul>
  <li>We are learning to...</li>
</ul>
<h2>Success Criteria</h2>
<ul>
  <li>I can...</li>
</ul>
<h2>Instructions</h2>
<ol>
  <li>Step one</li>
  <li>Step two</li>
</ol>`
      },
      {
        label: 'Insert Brainstorm',
        html: `<h2>Brainstorm</h2>
<ul>
  <li>What do we already know?</li>
  <li>What ideas can we build on?</li>
  <li>What questions do we have?</li>
</ul>`
      },
      {
        label: 'Insert Reflection',
        html: `<h2>Reflection</h2>
<ul>
  <li>What did you learn today?</li>
  <li>What challenged you?</li>
  <li>What will you try next lesson?</li>
</ul>`
      }
    ];

    templates.forEach((template) => {
      const button = document.createElement('button');
      button.className = 'control-button';
      button.type = 'button';
      button.textContent = template.label;
      button.addEventListener('click', () => this.insertTemplate(template.html));
      this.controls.appendChild(button);
    });

    this.element.appendChild(this.controls);

    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'rich-text-editor-container';
    this.editorContainer.style.height = '100%';

    this.element.appendChild(this.editorContainer);

    setTimeout(() => {
      const toolbarOptions = [
        [{ header: [2, 3, false] }],
        ['bold'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['insertSectionBlock', 'clean']
      ];

      this.quill = new Quill(this.editorContainer, {
        theme: 'snow',
        modules: {
          toolbar: {
            container: toolbarOptions,
            handlers: {
              insertSectionBlock: () => this.insertSectionBlock()
            }
          }
        }
      });

      const sectionButton = this.element.querySelector('.ql-insertSectionBlock');
      if (sectionButton) {
        sectionButton.textContent = 'Insert Section Block';
        sectionButton.setAttribute('aria-label', 'Insert Section Block');
      }

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

  insertSectionBlock() {
    this.insertHtml(`<div class="display-callout">
  <h3>Section Title</h3>
  <ul>
    <li>Point one</li>
    <li>Point two</li>
  </ul>
</div><p><br></p>`);
  }

  insertTemplate(templateHtml) {
    this.insertHtml(`${templateHtml}<p><br></p>`);
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
