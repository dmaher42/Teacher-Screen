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
    this.presentationMode = 'normal';
    this.isApplyingSmartFormatting = false;
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
    this.handleTemplateButtonClick = this.handleTemplateButtonClick.bind(this);
    this.handleModeButtonClick = this.handleModeButtonClick.bind(this);
    this.handleTemplateBuilderClick = this.handleTemplateBuilderClick.bind(this);
    this.syncEditorLayout = this.syncEditorLayout.bind(this);

    this.controlsOverlay = document.createElement('div');
    this.controlsOverlay.className = 'widget-content-controls rich-text-settings-controls';

    this.templateLabel = document.createElement('p');
    this.templateLabel.className = 'rich-text-controls-label';
    this.templateLabel.textContent = 'Quick Blocks';

    this.templateControls = document.createElement('div');
    this.templateControls.className = 'rich-text-controls';

    this.templateBuilderButton = document.createElement('button');
    this.templateBuilderButton.className = 'control-button';
    this.templateBuilderButton.type = 'button';
    this.templateBuilderButton.textContent = 'Build Template';
    this.templateBuilderButton.addEventListener('click', this.handleTemplateBuilderClick);
    this.templateControls.appendChild(this.templateBuilderButton);

    this.modeLabel = document.createElement('p');
    this.modeLabel.className = 'rich-text-controls-label';
    this.modeLabel.textContent = 'Presentation';

    this.modeControls = document.createElement('div');
    this.modeControls.className = 'rich-text-controls rich-text-controls--modes';

    this.displayModeButton = document.createElement('button');
    this.displayModeButton.className = 'control-button';
    this.displayModeButton.type = 'button';
    this.displayModeButton.textContent = 'Display';
    this.displayModeButton.setAttribute('aria-pressed', 'false');
    this.displayModeButton.title = 'Toggle display mode';
    this.displayModeButton.addEventListener('click', this.handleDisplayModeClick);

    this.templateButtons = [
      ['title', 'Title'],
      ['instructions', 'Instructions'],
      ['task', 'Task'],
      ['example', 'Example'],
      ['exit-ticket', 'Exit Ticket'],
      ['homework', 'Homework']
    ].map(([templateKey, label]) => {
      const button = document.createElement('button');
      button.className = 'control-button control-button--ghost';
      button.type = 'button';
      button.textContent = label;
      button.dataset.template = templateKey;
      button.addEventListener('click', this.handleTemplateButtonClick);
      this.templateControls.appendChild(button);
      return button;
    });

    this.modeButtons = [
      ['normal', 'Normal'],
      ['large', 'Large Text'],
      ['focus', 'Focus'],
      ['fullscreen', 'Full Screen']
    ].map(([modeKey, label]) => {
      const button = document.createElement('button');
      button.className = 'control-button control-button--ghost';
      button.type = 'button';
      button.textContent = label;
      button.dataset.mode = modeKey;
      button.addEventListener('click', this.handleModeButtonClick);
      this.modeControls.appendChild(button);
      return button;
    });

    this.modeControls.appendChild(this.displayModeButton);

    this.modeHint = document.createElement('p');
    this.modeHint.className = 'rich-text-mode-hint';

    this.controlsOverlay.appendChild(this.templateLabel);
    this.controlsOverlay.appendChild(this.templateControls);
    this.controlsOverlay.appendChild(this.modeLabel);
    this.controlsOverlay.appendChild(this.modeControls);
    this.controlsOverlay.appendChild(this.modeHint);
    this.updateDisplayModeUI();
    this.templateDialog = null;
    this.templateDialogSubmitHandler = null;

    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'rich-text-editor-container';

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
        placeholder: '',
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
      requestAnimationFrame(this.syncEditorLayout);
    }, 0);
  }

  getControls() {
    return this.controlsOverlay;
  }

  handleDisplayModeClick() {
    this.isDisplayMode = !this.isDisplayMode;
    this.updateDisplayModeUI();
  }

  handleTemplateButtonClick(event) {
    const templateKey = event.currentTarget?.dataset?.template;
    if (!templateKey) {
      return;
    }

    this.insertTemplate(templateKey);
  }

  getTemplateBuilderDefinitions() {
    return {
      instructions: {
        label: 'Instructions',
        fields: [
          { key: 'title', label: 'Title', placeholder: 'Instructions' },
          { key: 'step1', label: 'Step 1', placeholder: 'Open your book to page...' },
          { key: 'step2', label: 'Step 2', placeholder: 'Complete questions...' },
          { key: 'step3', label: 'Step 3', placeholder: 'Check your answer with...' }
        ],
        buildHtml: (values) => `
          <h2>${this.escapeHtml(values.title || 'Instructions')}</h2>
          <ol>
            ${[values.step1, values.step2, values.step3].filter(Boolean).map((step) => `<li>${this.escapeHtml(step)}</li>`).join('')}
          </ol>
        `
      },
      'do-now': {
        label: 'Do Now',
        fields: [
          { key: 'title', label: 'Title', placeholder: 'Do Now' },
          { key: 'prompt', label: 'Prompt', placeholder: 'Answer the question below...' },
          { key: 'time', label: 'Time', placeholder: '5 minutes' }
        ],
        buildHtml: (values) => `
          <h2>${this.escapeHtml(values.title || 'Do Now')}</h2>
          <div class="display-callout"><strong>Time</strong><p>${this.escapeHtml(values.time || '5 minutes')}</p></div>
          <p>${this.escapeHtml(values.prompt || '')}</p>
        `
      },
      'success-criteria': {
        label: 'Success Criteria',
        fields: [
          { key: 'title', label: 'Title', placeholder: 'Success Criteria' },
          { key: 'criterion1', label: 'Criterion 1', placeholder: 'I can explain...' },
          { key: 'criterion2', label: 'Criterion 2', placeholder: 'I can solve...' },
          { key: 'criterion3', label: 'Criterion 3', placeholder: 'I can check...' }
        ],
        buildHtml: (values) => `
          <h2>${this.escapeHtml(values.title || 'Success Criteria')}</h2>
          <ul>
            ${[values.criterion1, values.criterion2, values.criterion3].filter(Boolean).map((item) => `<li>${this.escapeHtml(item)}</li>`).join('')}
          </ul>
        `
      },
      'exit-ticket': {
        label: 'Exit Ticket',
        fields: [
          { key: 'title', label: 'Title', placeholder: 'Exit Ticket' },
          { key: 'question1', label: 'Question 1', placeholder: 'What did you learn today?' },
          { key: 'question2', label: 'Question 2', placeholder: 'What was challenging?' },
          { key: 'question3', label: 'Question 3', placeholder: 'What do you want to review?' }
        ],
        buildHtml: (values) => `
          <h2>${this.escapeHtml(values.title || 'Exit Ticket')}</h2>
          <ol>
            ${[values.question1, values.question2, values.question3].filter(Boolean).map((item) => `<li>${this.escapeHtml(item)}</li>`).join('')}
          </ol>
        `
      },
      homework: {
        label: 'Homework',
        fields: [
          { key: 'title', label: 'Title', placeholder: 'Homework' },
          { key: 'task', label: 'Task', placeholder: 'Complete the worksheet...' },
          { key: 'due', label: 'Due', placeholder: 'Due Friday' }
        ],
        buildHtml: (values) => `
          <h2>${this.escapeHtml(values.title || 'Homework')}</h2>
          <p>${this.escapeHtml(values.task || '')}</p>
          <div class="display-callout"><strong>Due</strong><p>${this.escapeHtml(values.due || '')}</p></div>
        `
      },
      outline: {
        label: 'Lesson Outline',
        fields: [
          { key: 'title', label: 'Title', placeholder: 'Lesson Outline' },
          { key: 'starter', label: 'Starter', placeholder: 'Warm up / intro...' },
          { key: 'main', label: 'Main Task', placeholder: 'Main activity...' },
          { key: 'plenary', label: 'Plenary', placeholder: 'Review / close...' }
        ],
        buildHtml: (values) => `
          <h2>${this.escapeHtml(values.title || 'Lesson Outline')}</h2>
          <h3>Starter</h3>
          <p>${this.escapeHtml(values.starter || '')}</p>
          <h3>Main Task</h3>
          <p>${this.escapeHtml(values.main || '')}</p>
          <h3>Plenary</h3>
          <p>${this.escapeHtml(values.plenary || '')}</p>
        `
      }
    };
  }

  escapeHtml(value = '') {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  ensureTemplateDialog() {
    if (this.templateDialog && document.body.contains(this.templateDialog)) {
      return this.templateDialog;
    }

    const dialog = document.createElement('dialog');
    dialog.className = 'rich-text-template-dialog';
    dialog.innerHTML = `
      <div class="modal-header">
        <h3>Load Into Rich Text</h3>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <form class="rich-text-template-form" method="dialog">
        <div class="modal-body rich-text-template-body">
          <label class="rich-text-template-label">
            <span>Template</span>
            <select class="rich-text-template-select"></select>
          </label>
          <div class="rich-text-template-fields"></div>
        </div>
        <div class="modal-actions">
          <button class="control-button rich-text-template-load" type="submit" value="load">Load Template</button>
          <button class="control-button" type="button" data-close>Cancel</button>
        </div>
      </form>
    `;

    dialog.querySelector('.modal-close')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    document.body.appendChild(dialog);
    this.templateDialog = dialog;
    return dialog;
  }

  renderTemplateDialogFields(templateKey) {
    const dialog = this.ensureTemplateDialog();
    const select = dialog.querySelector('.rich-text-template-select');
    const fieldsContainer = dialog.querySelector('.rich-text-template-fields');
    const templates = this.getTemplateBuilderDefinitions();
    const definition = templates[templateKey] || templates.instructions;

    if (!select.dataset.initialized) {
      Object.entries(templates).forEach(([key, template]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = template.label;
        select.appendChild(option);
      });
      select.dataset.initialized = 'true';
      select.addEventListener('change', () => this.renderTemplateDialogFields(select.value));
    }

    select.value = templateKey;
    fieldsContainer.innerHTML = '';

    definition.fields.forEach((field) => {
      const label = document.createElement('label');
      label.className = 'rich-text-template-label';
      label.innerHTML = `<span>${field.label}</span>`;

      const input = field.multiline ? document.createElement('textarea') : document.createElement('input');
      input.className = 'rich-text-template-input';
      input.name = field.key;
      input.placeholder = field.placeholder || '';
      if (!field.multiline) {
        input.type = 'text';
      }

      label.appendChild(input);
      fieldsContainer.appendChild(label);
    });

    const firstField = fieldsContainer.querySelector('.rich-text-template-input');
    if (firstField) {
      setTimeout(() => firstField.focus(), 0);
    }
  }

  buildTemplateHtml(templateKey, values = {}) {
    const templates = this.getTemplateBuilderDefinitions();
    const definition = templates[templateKey] || templates.instructions;
    return definition.buildHtml(values).trim();
  }

  loadTemplateHtml(html) {
    if (!this.quill) {
      this.pendingContent = html;
      return;
    }

    this.quill.setContents([], 'silent');
    this.quill.clipboard.dangerouslyPasteHTML(0, html);
    this.quill.setSelection(this.quill.getLength(), 0, 'silent');
    this.pendingContent = this.quill.root.innerHTML;
    document.dispatchEvent(new CustomEvent('widgetChanged', { detail: { widget: this } }));
  }

  handleTemplateBuilderClick() {
    const dialog = this.ensureTemplateDialog();
    const initialTemplate = dialog.querySelector('.rich-text-template-select')?.value || 'instructions';
    this.renderTemplateDialogFields(initialTemplate);

    dialog.returnValue = '';
    dialog.showModal();

    const form = dialog.querySelector('.rich-text-template-form');
    if (form && this.templateDialogSubmitHandler) {
      form.removeEventListener('submit', this.templateDialogSubmitHandler);
    }

    const submitHandler = (event) => {
      event.preventDefault();
      const templateKey = dialog.querySelector('.rich-text-template-select')?.value || 'instructions';
      const values = {};
      dialog.querySelectorAll('.rich-text-template-input').forEach((input) => {
        values[input.name] = input.value.trim();
      });

      const nextHtml = this.buildTemplateHtml(templateKey, values);
      if (this.pendingContent && this.pendingContent.replace(/<p><br><\/p>/g, '').trim()) {
        const confirmed = window.confirm('Replace the current Rich Text content with this template?');
        if (!confirmed) {
          return;
        }
      }

      this.loadTemplateHtml(nextHtml);
      dialog.close();
    };

    this.templateDialogSubmitHandler = submitHandler;
    form?.addEventListener('submit', submitHandler);
  }

  handleModeButtonClick(event) {
    const mode = event.currentTarget?.dataset?.mode || 'normal';
    this.presentationMode = mode;
    if (mode !== 'normal') {
      this.isDisplayMode = true;
    }
    this.updateDisplayModeUI();
  }

  getInsertedText(delta = {}) {
    if (!Array.isArray(delta?.ops)) {
      return '';
    }

    return delta.ops
      .map((op) => (typeof op?.insert === 'string' ? op.insert : ''))
      .join('');
  }

  getLineContextAtIndex(index) {
    if (!this.quill || index < 0) {
      return null;
    }

    const [line] = this.quill.getLine(index);
    if (!line || !line.domNode) {
      return null;
    }

    const lineStart = this.quill.getIndex(line);
    const lineLength = Math.max(0, line.length() - 1);
    const rawText = this.quill.getText(lineStart, lineLength).replace(/\r/g, '');
    const plainText = rawText.replace(/\u00a0/g, ' ');
    const trimmedText = plainText.trim();
    const formats = this.quill.getFormat(lineStart, Math.max(1, lineLength || 1));

    return {
      line,
      lineStart,
      lineLength,
      rawText,
      plainText,
      trimmedText,
      formats
    };
  }

  applySilentTransform(transform) {
    if (!this.quill || this.isApplyingSmartFormatting) {
      return false;
    }

    this.isApplyingSmartFormatting = true;
    try {
      return transform() === true;
    } finally {
      this.isApplyingSmartFormatting = false;
    }
  }

  isSmartHeadingLine(context) {
    if (!context || context.formats?.header || context.formats?.list) {
      return false;
    }

    if (!/:\s*$/.test(context.plainText)) {
      return false;
    }

    const headingText = context.plainText.replace(/:\s*$/, '').trim();
    if (!headingText) {
      return false;
    }

    const wordCount = headingText.split(/\s+/).filter(Boolean).length;
    return wordCount <= 5 && headingText.length <= 48;
  }

  applySmartFormattingToPreviousLine() {
    if (!this.quill) {
      return false;
    }

    const selection = this.quill.getSelection(true);
    const targetIndex = Math.max(0, (selection?.index ?? this.quill.getLength()) - 2);
    const context = this.getLineContextAtIndex(targetIndex);
    if (!context || !context.trimmedText) {
      return false;
    }

    if (!context.formats?.list) {
      const bulletMatch = context.plainText.match(/^\s*[-*]\s+/);
      const orderedMatch = context.plainText.match(/^\s*\d+[.)]\s+/);
      if (bulletMatch || orderedMatch) {
        return this.applySilentTransform(() => {
          const selectionIndex = this.quill.getSelection(true)?.index ?? selection?.index ?? 0;
          const markerLength = (bulletMatch || orderedMatch)[0].length;
          const listType = bulletMatch ? 'bullet' : 'ordered';

          this.quill.deleteText(context.lineStart, markerLength, 'silent');
          this.quill.formatLine(context.lineStart, 1, 'list', listType, 'silent');
          this.quill.setSelection(Math.max(context.lineStart, selectionIndex - markerLength), 0, 'silent');
          return true;
        });
      }
    }

    if (!this.isSmartHeadingLine(context)) {
      return false;
    }

    return this.applySilentTransform(() => {
      const selectionIndex = this.quill.getSelection(true)?.index ?? selection?.index ?? 0;
      const colonIndex = context.plainText.lastIndexOf(':');
      const headingText = context.plainText.replace(/:\s*$/, '').trim();
      const headingLevel = headingText.split(/\s+/).filter(Boolean).length <= 2 ? 2 : 3;

      if (colonIndex >= 0) {
        this.quill.deleteText(context.lineStart + colonIndex, 1, 'silent');
      }

      this.quill.formatLine(context.lineStart, 1, 'header', headingLevel, 'silent');
      this.quill.setSelection(Math.max(context.lineStart, selectionIndex - 1), 0, 'silent');
      return true;
    });
  }

  maybeApplySmartFormatting(delta = {}, source = 'api') {
    if (!this.quill || source !== 'user' || this.isApplyingSmartFormatting) {
      return;
    }

    const insertedText = this.getInsertedText(delta);
    if (!insertedText) {
      return;
    }

    if (insertedText.includes('\n')) {
      this.applySmartFormattingToPreviousLine();
    }
  }

  handleTextChange(delta, oldDelta, source) {
    if (!this.quill) {
      return;
    }

    this.maybeApplySmartFormatting(delta, source);
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
    this.quill.setSelection(this.quill.getLength(), 0);
  }

  getTemplateMarkup(templateKey) {
    const templateMap = {
      title: '<h2>Lesson Title</h2><p>Start with a short intro or objective.</p>',
      instructions: '<h3>Instructions</h3><ul><li>Step 1</li><li>Step 2</li><li>Step 3</li></ul>',
      task: '<div class="display-callout"><strong>Task</strong><p>Complete the activity and be ready to share your answer.</p></div>',
      example: '<h3>Example</h3><p><strong>Model answer:</strong> Add a worked example here.</p>',
      'exit-ticket': '<h3>Exit Ticket</h3><ol><li>What did you learn today?</li><li>What is one thing you still need help with?</li></ol>',
      homework: '<h3>Homework</h3><ul><li>Complete the task set in class.</li><li>Bring your notes next lesson.</li></ul>'
    };

    return templateMap[templateKey] || '';
  }

  insertTemplate(templateKey) {
    if (!this.quill) {
      return;
    }

    const html = this.getTemplateMarkup(templateKey);
    if (!html) {
      return;
    }

    const range = this.quill.getSelection(true);
    const insertIndex = range ? range.index : this.quill.getLength();
    const needsSpacing = insertIndex > 0 ? '<p><br></p>' : '';
    this.quill.clipboard.dangerouslyPasteHTML(insertIndex, `${needsSpacing}${html}`);
    this.quill.setSelection(this.quill.getLength(), 0);
  }

  serialize() {
    return {
      content: this.quill ? this.quill.root.innerHTML : this.pendingContent,
      displayMode: this.isDisplayMode,
      presentationMode: this.presentationMode
    };
  }

  deserialize(data) {
    this.pendingContent = data?.content || '';
    this.isDisplayMode = data?.displayMode === true;
    this.presentationMode = data?.presentationMode || 'normal';
    this.element.classList.toggle('display-mode', this.isDisplayMode);
    this.element.classList.toggle('is-projector-mode', this.isProjectorMode());
    this.updateDisplayModeUI();

    if (this.quill) {
      this.quill.root.innerHTML = this.pendingContent;
      this.syncEditorLayout();
    }
  }

  onWidgetLayout() {
    this.syncEditorLayout();
  }

  syncEditorLayout() {
    if (!this.editorContainer) {
      return;
    }

    const toolbar = this.editorContainer.querySelector('.ql-toolbar');
    const editorShell = this.editorContainer.querySelector('.ql-container');
    const editor = this.editorContainer.querySelector('.ql-editor');

    if (!editorShell || !editor) {
      return;
    }

    const toolbarHeight = toolbar?.offsetHeight || 0;
    const availableHeight = this.editorContainer.clientHeight - toolbarHeight;

    if (availableHeight <= 0) {
      return;
    }

    editorShell.style.height = `${availableHeight}px`;
    editor.style.minHeight = `${availableHeight}px`;
  }

  updateDisplayModeUI() {
    this.element.classList.toggle('is-projector-mode', this.isProjectorMode());
    this.element.classList.toggle('display-mode', this.isDisplayMode);
    this.element.dataset.presentationMode = this.presentationMode;
    this.displayModeButton.textContent = this.isDisplayMode ? 'Edit' : 'Display';
    this.displayModeButton.setAttribute('aria-pressed', this.isDisplayMode ? 'true' : 'false');

    const modeLabels = {
      normal: 'Normal display layout',
      large: 'Large text presentation mode',
      focus: 'Focused reading mode',
      fullscreen: 'Full screen presentation mode'
    };

    this.modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === this.presentationMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (this.modeHint) {
      this.modeHint.textContent = this.isDisplayMode
        ? modeLabels[this.presentationMode] || modeLabels.normal
        : 'Choose a format, then switch to Display when you are ready to present.';
    }

    if (this.editorStatus) {
      this.editorStatus.textContent = this.isProjectorMode()
        ? 'Projector View'
        : this.isDisplayMode
          ? modeLabels[this.presentationMode] || modeLabels.normal
          : 'Edit';
    }

    if (this.quill) {
      this.quill.enable(!this.isProjectorMode() && !this.isDisplayMode);
      this.syncEditorLayout();
    }
  }

  remove() {
    this.displayModeButton.removeEventListener('click', this.handleDisplayModeClick);
    this.templateBuilderButton.removeEventListener('click', this.handleTemplateBuilderClick);
    this.templateButtons?.forEach((button) => {
      button.removeEventListener('click', this.handleTemplateButtonClick);
    });
    this.modeButtons?.forEach((button) => {
      button.removeEventListener('click', this.handleModeButtonClick);
    });

    if (this.initTimer) {
      clearTimeout(this.initTimer);
      this.initTimer = null;
    }

    if (this.quill && typeof this.quill.off === 'function') {
      this.quill.off('text-change', this.handleTextChange);
    }

    if (this.templateDialog) {
      this.templateDialog.remove();
      this.templateDialog = null;
    }
    this.templateDialogSubmitHandler = null;

    this.quill = null;
    this.element.remove();

    const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
    document.dispatchEvent(event);
  }
}
