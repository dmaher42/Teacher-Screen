if (window.Quill && !window.Quill.imports['formats/displayCallout']) {
  const Block = window.Quill.import('blots/block');

  class DisplayCalloutBlot extends Block {
    static blotName = 'displayCallout';
    static tagName = 'div';
    static className = 'display-callout';
  }

  window.Quill.register(DisplayCalloutBlot, true);
}

if (window.Quill && !window.Quill.imports['formats/lineSpacing']) {
  const Parchment = window.Quill.import('parchment');
  const LineSpacingClass = new Parchment.ClassAttributor('lineSpacing', 'ql-line-spacing', {
    scope: Parchment.Scope.BLOCK,
    whitelist: ['tight', 'normal', 'relaxed']
  });

  window.Quill.register(LineSpacingClass, true);
}

class RichTextWidget {
  constructor() {
    this.pendingContent = '';
    this.customTitle = '';
    this.teacherOnly = false;
    this.showOnEveryPage = false;
    this.keepInFront = false;
    this.instructionAppearance = false;
    this.instructionFontSize = 28;
    this.isDisplayMode = false;
    this.presentationMode = 'normal';
    this.isApplyingSmartFormatting = false;
    this.lastEditorSelection = null;
    this.autoFitFrame = null;
    this.autoFitTimer = null;
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
    this.handleEditorToolbarChange = this.handleEditorToolbarChange.bind(this);
    this.handleEditorToolbarClick = this.handleEditorToolbarClick.bind(this);
    this.handleEditorToolbarPointerDown = this.handleEditorToolbarPointerDown.bind(this);
    this.handleEditorSelectionChange = this.handleEditorSelectionChange.bind(this);
    this.handleInlineEditClick = this.handleInlineEditClick.bind(this);
    this.handleDocumentKeydown = this.handleDocumentKeydown.bind(this);
    this.syncToolbarState = this.syncToolbarState.bind(this);
    this.syncEditorLayout = this.syncEditorLayout.bind(this);
    document.addEventListener('keydown', this.handleDocumentKeydown);

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
    this.modeLabel.textContent = 'Display';

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
      ['large', 'Large Text']
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
    this.editorToolbar = this.createEditorToolbar();
    this.scopeOptions = document.createElement('div');
    this.scopeOptions.className = 'rich-text-scope-options';
    this.scopeInputs = {};
    for (const [key, labelText] of [['showOnEveryPage', 'Show on every page'], ['keepInFront', 'Keep in front of presentations']]) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.textBoardOption = key;
      input.addEventListener('change', () => {
        if (key === 'showOnEveryPage' && input.checked && !this.showOnEveryPage && this.widgetInfo) {
          this.widgetId = `shared-text-${crypto.randomUUID()}`;
          this.widgetInfo.id = this.widgetId;
        }
        this[key] = input.checked;
        this.updateDisplayModeUI();
        window.TeacherScreenWidgetState.notifyChanged(this, 'text-board-options-updated');
      });
      label.append(input, document.createTextNode(labelText));
      this.scopeOptions.append(label);
      this.scopeInputs[key] = input;
    }
    this.editorSurface = document.createElement('div');
    this.editorSurface.className = 'rich-text-editor-surface';
    this.editorSurface.addEventListener('input', () => {
      if (this.quill || this.isProjectorMode() || this.isDisplayMode) return;
      this.pendingContent = this.editorSurface.innerHTML;
      this.updateHeaderTitle();
      window.TeacherScreenWidgetState.notifyChanged(this, 'content-updated');
    });
    this.inlineEditButton = document.createElement('button');
    this.inlineEditButton.className = 'rich-text-inline-edit-button';
    this.inlineEditButton.type = 'button';
    this.inlineEditButton.textContent = 'Edit';
    this.inlineEditButton.title = 'Show text toolbar';
    this.inlineEditButton.setAttribute('aria-label', 'Show text toolbar');
    this.inlineEditButton.addEventListener('click', this.handleInlineEditClick);
    this.editorContainer.append(this.editorToolbar, this.editorSurface, this.inlineEditButton);

    this.element.appendChild(this.editorContainer);

    this.initTimer = setTimeout(() => {
      const QuillEditor = window.Quill;
      if (!QuillEditor) {
        console.warn('Rich Text editor could not start because Quill is unavailable.');
        this.editorSurface.classList.add('ql-editor', 'rich-text-editor-fallback');
        this.editorToolbar.querySelectorAll('select, button:not([data-action="display"])').forEach(control => {
          control.disabled = true;
          control.title = 'Formatting is unavailable; you can still edit the text.';
        });
        this.editorSurface.innerHTML = this.pendingContent;
        this.updateDisplayModeUI();
        this.syncEditorLayout();
        return;
      }

      const SizeStyle = QuillEditor.import('attributors/style/size');
      SizeStyle.whitelist = ['small', 'large', 'huge', ...[12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64].map(size => `${size}px`)];
      QuillEditor.register(SizeStyle, true);

      const ColorStyle = QuillEditor.import('attributors/style/color');
      QuillEditor.register(ColorStyle, true);

      const BackgroundStyle = QuillEditor.import('attributors/style/background');
      QuillEditor.register(BackgroundStyle, true);

      this.quill = new QuillEditor(this.editorSurface, {
        theme: 'snow',
        placeholder: 'Start with a clear heading, a short prompt, or a teaching block…',
        modules: {
          toolbar: false,
          table: true,
          history: {
            delay: 400,
            maxStack: 100,
            userOnly: true
          }
        }
      });

      if (this.pendingContent) {
        this.quill.root.innerHTML = this.pendingContent;
      }

      this.quill.on('text-change', this.handleTextChange);
      this.quill.on('selection-change', this.handleEditorSelectionChange);
      this.editorToolbar.addEventListener('change', this.handleEditorToolbarChange);
      this.editorToolbar.addEventListener('click', this.handleEditorToolbarClick);
      this.editorToolbar.addEventListener('pointerdown', this.handleEditorToolbarPointerDown);
      this.syncToolbarState();
      this.updateDisplayModeUI();
      requestAnimationFrame(this.syncEditorLayout);
    }, 0);
  }

  createEditorToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'rich-text-editor-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Rich text formatting');
    this.populateCompactEditorToolbar(toolbar);
    return toolbar;
  }

  populateCompactEditorToolbar(toolbar) {
    const paths = {
      bullet: '<circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/><path d="M9 6h11M9 12h11M9 18h11"/>',
      ordered: '<path d="M3 3h1v6M3 9h3M2 14c0-3 5-3 5 0 0 2-4 3-4 5h4M11 6h10M11 16h10"/>',
      more: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
      link: '<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
      highlight: '<path d="m9 16 8-12 5 4-9 11-4-3ZM9 16l-3 4h7M3 22h17"/>',
      clean: '<path d="m4 13 9-10 8 7-9 11H7l-3-3a3 3 0 0 1 0-5Zm4-4 9 8M12 21h10"/>',
      columns: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16"/>',
      undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
      redo: '<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14"/>',
      done: '<path d="m4 12 5 5L20 6"/>'
    };
    const icon = name => `<svg class="rich-text-toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
    toolbar.innerHTML = `
      <div class="rich-text-toolbar-main">
        <div class="rich-text-toolbar-group rich-text-toolbar-group--text" aria-label="Text formatting">
          <label class="rich-text-toolbar-field rich-text-toolbar-field--style">
            <span class="visually-hidden">Text style</span>
            <select data-format="header" aria-label="Text style">
              <option value="">Body</option>
              <option value="2">Heading</option>
              <option value="3">Subheading</option>
              <option value="small">Small notes</option>
            </select>
          </label>
        </div>
        <div class="rich-text-toolbar-group">
          <label class="rich-text-toolbar-field rich-text-toolbar-field--size">
            <span class="visually-hidden">Text size</span>
            <select data-format="size" aria-label="Text size" title="Text size in pixels (Auto uses the text style)"><option value="">Auto</option>${[12,16,20,24,28,32,36,40,48,56,64].map(size => `<option value="${size}px">${size}</option>`).join('')}</select>
          </label>
        </div>
        <div class="rich-text-toolbar-group" aria-label="Emphasis">
          <div class="rich-text-toolbar-actions rich-text-toolbar-actions--core" aria-label="Emphasis">
            <button type="button" data-format="bold" aria-label="Bold" aria-pressed="false" title="Bold">B</button>
            <button type="button" class="rich-text-toolbar-italic" data-format="italic" aria-label="Italic" aria-pressed="false" title="Italic">I</button>
            <button type="button" class="rich-text-toolbar-underline" data-format="underline" aria-label="Underline" aria-pressed="false" title="Underline">U</button>
          </div>
        </div>
        <div class="rich-text-toolbar-group rich-text-toolbar-group--structure" aria-label="Lists">
          <div class="rich-text-toolbar-actions">
            <button type="button" data-list="bullet" aria-label="Bullet list" aria-pressed="false" title="Bullet list">${icon('bullet')}</button>
            <button type="button" data-list="ordered" aria-label="Numbered list" aria-pressed="false" title="Numbered list">${icon('ordered')}</button>
          </div>

        </div>
      </div>
      <div class="rich-text-toolbar-secondary">
      <details class="rich-text-toolbar-more">
        <summary aria-label="More formatting tools" title="More formatting tools">${icon('more')}</summary>
        <div class="rich-text-toolbar-more-panel">
          <div class="rich-text-toolbar-more-section">
            <span class="rich-text-toolbar-menu-label">Editing</span>
            <div class="rich-text-toolbar-actions" aria-label="More text actions">
              <button type="button" data-action="undo" aria-label="Undo" title="Undo">${icon('undo')}<span>Undo</span></button>
              <button type="button" data-action="redo" aria-label="Redo" title="Redo">${icon('redo')}<span>Redo</span></button>
              <button type="button" data-action="link" aria-label="Add link" title="Add link">${icon('link')}<span>Link</span></button>
              <button type="button" data-action="clean" aria-label="Clear formatting" title="Clear formatting">${icon('clean')}<span>Clear formatting</span></button>
            </div>
          </div>
          <div class="rich-text-toolbar-more-section">
            <span class="rich-text-toolbar-menu-label">Colour</span>
            <div class="rich-text-toolbar-colour-tools" aria-label="Colour formatting">
              <details class="rich-text-toolbar-colour-menu" data-format-menu="color" data-default-value="#111827">
                <summary aria-label="Text colour" title="Text colour">
                  <span class="rich-text-colour-letter" aria-hidden="true">A</span>
                  <span class="rich-text-colour-preview" style="--swatch-color: #111827" aria-hidden="true"></span>
                </summary>
                <div class="rich-text-toolbar-colour-panel" role="group" aria-label="Text colour palette">
                  <span class="rich-text-toolbar-menu-label">Text colour</span>
                  <div class="rich-text-toolbar-palette-swatches">
                    <button type="button" class="rich-text-swatch" style="--swatch-color: #111827" data-format="color" data-value="#111827" aria-label="Black text" aria-pressed="false" title="Black text"><span class="visually-hidden">Black</span></button>
                    <button type="button" class="rich-text-swatch" style="--swatch-color: #dc2626" data-format="color" data-value="#dc2626" aria-label="Red text" aria-pressed="false" title="Red text"><span class="visually-hidden">Red</span></button>
                    <button type="button" class="rich-text-swatch" style="--swatch-color: #2563eb" data-format="color" data-value="#2563eb" aria-label="Blue text" aria-pressed="false" title="Blue text"><span class="visually-hidden">Blue</span></button>
                    <button type="button" class="rich-text-swatch" style="--swatch-color: #16a34a" data-format="color" data-value="#16a34a" aria-label="Green text" aria-pressed="false" title="Green text"><span class="visually-hidden">Green</span></button>
                    <button type="button" class="rich-text-swatch" style="--swatch-color: #7c3aed" data-format="color" data-value="#7c3aed" aria-label="Purple text" aria-pressed="false" title="Purple text"><span class="visually-hidden">Purple</span></button>
                    <button type="button" class="rich-text-swatch" style="--swatch-color: #ea580c" data-format="color" data-value="#ea580c" aria-label="Orange text" aria-pressed="false" title="Orange text"><span class="visually-hidden">Orange</span></button>
                    <button type="button" class="rich-text-swatch" style="--swatch-color: #ffffff" data-format="color" data-value="#ffffff" aria-label="White text" aria-pressed="false" title="White text"><span class="visually-hidden">White</span></button>
                    <button type="button" class="rich-text-swatch rich-text-swatch--reset" data-format="color" data-value="" aria-label="Default text colour" aria-pressed="false" title="Default text colour"><span aria-hidden="true">&times;</span></button>
                  </div>
                </div>
              </details>
              <details class="rich-text-toolbar-colour-menu rich-text-toolbar-colour-menu--highlight" data-format-menu="background" data-default-value="#fef08a">
                <summary aria-label="Highlight colour" title="Highlight colour">
                  ${icon('highlight')}
                  <span class="rich-text-colour-preview rich-text-colour-preview--highlight" style="--swatch-color: #fef08a" aria-hidden="true"></span>
                </summary>
                <div class="rich-text-toolbar-colour-panel" role="group" aria-label="Highlight colour palette">
                  <span class="rich-text-toolbar-menu-label">Highlight colour</span>
                  <div class="rich-text-toolbar-palette-swatches">
                    <button type="button" class="rich-text-swatch rich-text-swatch--highlight" style="--swatch-color: #fef08a" data-format="background" data-value="#fef08a" aria-label="Yellow highlight" aria-pressed="false" title="Yellow highlight"><span class="visually-hidden">Yellow</span></button>
                    <button type="button" class="rich-text-swatch rich-text-swatch--highlight" style="--swatch-color: #bbf7d0" data-format="background" data-value="#bbf7d0" aria-label="Green highlight" aria-pressed="false" title="Green highlight"><span class="visually-hidden">Green</span></button>
                    <button type="button" class="rich-text-swatch rich-text-swatch--highlight" style="--swatch-color: #bfdbfe" data-format="background" data-value="#bfdbfe" aria-label="Blue highlight" aria-pressed="false" title="Blue highlight"><span class="visually-hidden">Blue</span></button>
                    <button type="button" class="rich-text-swatch rich-text-swatch--highlight" style="--swatch-color: #fbcfe8" data-format="background" data-value="#fbcfe8" aria-label="Pink highlight" aria-pressed="false" title="Pink highlight"><span class="visually-hidden">Pink</span></button>
                    <button type="button" class="rich-text-swatch rich-text-swatch--reset" data-format="background" data-value="" aria-label="Remove highlight" aria-pressed="false" title="Remove highlight"><span aria-hidden="true">&times;</span></button>
                  </div>
                </div>
              </details>
            </div>
          </div>
          <div class="rich-text-toolbar-more-section">
            <span class="rich-text-toolbar-menu-label">Text and layout</span>
          <label class="rich-text-toolbar-layout-field">
            <span>Alignment</span>
            <select data-format="align" aria-label="Alignment">
              <option value="">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>

            <div class="rich-text-toolbar-more-row">
              <label class="rich-text-toolbar-layout-field">
                <span>Line spacing</span>
                <select data-format="lineSpacing" aria-label="Line spacing">
                  <option value="tight">Tight</option>
                  <option value="">Normal</option>
                  <option value="relaxed">Relaxed</option>
                </select>
              </label>
              <div class="rich-text-toolbar-actions">
                <button type="button" data-action="columns" aria-label="Insert two columns" title="Insert two columns">${icon('columns')}<span>Columns</span></button>
              </div>
            </div>
          </div>
          <details class="rich-text-toolbar-more-section rich-text-toolbar-more-section--teaching"><summary>Insert teaching blocks</summary><div class="rich-text-toolbar-insert-content">
            <span class="rich-text-toolbar-menu-label">Teaching blocks</span>
            <div class="rich-text-toolbar-insert-grid" aria-label="Insert teaching block">
              <button type="button" data-insert="learning-intention">Learning intention</button>
              <button type="button" data-insert="success-criteria">Success criteria</button>
              <button type="button" data-insert="warm-up">Warm-up</button>
              <button type="button" data-insert="discussion-question">Discussion question</button>
              <button type="button" data-insert="exit-ticket">Exit ticket</button>
            </div>
            <span class="rich-text-toolbar-menu-label">Callouts</span>
            <div class="rich-text-toolbar-insert-grid rich-text-toolbar-insert-grid--callouts" aria-label="Insert classroom callout">
              <button type="button" data-insert="tip">Tip</button>
              <button type="button" data-insert="remember">Remember</button>
              <button type="button" data-insert="important">Important</button>
              <button type="button" data-insert="question">Question</button>
              <button type="button" data-insert="answer">Answer</button>
            </div>
          </div></details>
          <p class="rich-text-toolbar-status" role="status" hidden></p>
        </div>
      </details>
      <button type="button" class="rich-text-toolbar-done" data-action="display" aria-label="Finish editing" title="Finish editing">${icon('done')}</button>
      </div>
    `;

    toolbar.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const menu = event.target.closest('details[open]') || toolbar.querySelector('details[open]');
      if (!menu) return;
      event.preventDefault(); event.stopPropagation();
      menu.open = false; menu.querySelector('summary')?.focus();
    });
    toolbar.querySelectorAll('details').forEach((menu) => {
      menu.addEventListener('toggle', () => {
        if (!menu.open) {
          return;
        }
        if (menu.classList.contains('rich-text-toolbar-more')) {
          const widgetBounds = toolbar.closest('.widget')?.getBoundingClientRect();
          const toolbarBounds = toolbar.getBoundingClientRect();
          menu.querySelector('.rich-text-toolbar-more-panel').scrollTop = 0;
          if (widgetBounds) {
            const availableHeight = Math.max(120, Math.floor(widgetBounds.bottom - toolbarBounds.bottom - 14));
            menu.style.setProperty('--rich-text-more-max-height', `${availableHeight}px`);
          }
        }
        toolbar.querySelectorAll('details[open]').forEach((otherMenu) => {
          const menusAreNested = otherMenu.contains(menu) || menu.contains(otherMenu);
          if (otherMenu !== menu && !menusAreNested) {
            otherMenu.open = false;
          }
        });
      });
    });
  }

  getControls() {
    return this.controlsOverlay;
  }

  getHeaderTitle() {
    if (this.customTitle) return this.customTitle;
    const content = document.createElement('div');
    content.innerHTML = this.quill ? this.quill.root.innerHTML : this.pendingContent;
    content.querySelectorAll('script, style').forEach(node => node.remove());
    content.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, br, tr').forEach(node => node.append(' '));
    return (content.textContent || '').trim().split(/\s+/u).filter(Boolean).slice(0, 2).join(' ').slice(0, 80) || 'Text Board';
  }

  updateHeaderTitle() {
    const title = this.headerTitleElement;
    if (!title) return;
    const name = this.getHeaderTitle();
    title.querySelector('span').textContent = name;
    title.setAttribute('aria-label', `Move Text Board: ${name}`);
    title.title = `Drag to move Text Board: ${name}`;
  }

  setCustomTitle(name) {
    this.customTitle = String(name || '').trim().replace(/\s+/gu, ' ').slice(0, 80);
    this.updateHeaderTitle();
    window.TeacherScreenWidgetState.notifyChanged(this, 'title-updated');
  }

  getHeaderMenuContent() { return this.scopeOptions; }

  getHeaderMenuActions() {
    if (this.isProjectorMode()) {
      return [];
    }

    return [{
      className: 'rich-text-rename-menu-item',
      iconClass: 'fas fa-pen',
      label: 'Rename board',
      onSelect: () => {
        const name = window.prompt('Name this Text Board (leave blank for an automatic name):', this.customTitle || this.getHeaderTitle());
        if (name !== null) this.setCustomTitle(name);
      }
    }, {
      className: 'rich-text-auto-name-menu-item',
      iconClass: 'fas fa-font',
      label: 'Use automatic name',
      onSelect: () => this.setCustomTitle('')
    }, {
      className: 'rich-text-present-menu-item',
      iconClass: 'fas fa-expand',
      label: 'Present',
      ariaLabel: 'Present Text Board',
      title: 'Present Text Board',
      onSelect: () => this.enterPresentationMode()
    }];
  }

  handleEditorToolbarChange(event) {
    if (!this.quill || event.target.tagName !== 'SELECT') return;
    const format = event.target.dataset.format;
    if (!format) return;
    let value = event.target.value || false;
    this.restoreEditorSelection();
    this.quill.history?.cutoff();
    if (format === 'header') {
      this.quill.format('size', value === 'small' ? 'small' : false, 'user');
      value = value === 'small' ? false : value ? Number(value) : false;
    }
    this.quill.format(format, value, 'user');
    this.quill.history?.cutoff();
    this.syncToolbarState();
  }

  handleEditorSelectionChange(range) {
    if (range) {
      this.lastEditorSelection = { index: range.index, length: range.length };
    }
    this.syncToolbarState();
  }

  handleEditorToolbarPointerDown(event) {
    const range = this.quill?.getSelection();
    if (range) {
      this.lastEditorSelection = { index: range.index, length: range.length };
    }
    if (event.target.closest('button')) event.preventDefault();
  }

  restoreEditorSelection() {
    const currentRange = this.quill.getSelection();
    const rememberedRange = currentRange || this.lastEditorSelection;
    const editorLength = this.quill.getLength();
    const index = Math.max(0, Math.min(Number(rememberedRange?.index) || 0, Math.max(0, editorLength - 1)));
    const length = Math.max(0, Math.min(Number(rememberedRange?.length) || 0, editorLength - index));
    const range = { index, length };

    this.lastEditorSelection = range;
    this.quill.focus();
    this.quill.setSelection(range.index, range.length, 'silent');
    return range;
  }

  handleEditorToolbarClick(event) {
    const button = event.target.closest('button');
    if (!button || !this.editorToolbar.contains(button)) return;
    if (button.dataset.action === 'display') {
      this.editorToolbar.querySelectorAll('details[open]').forEach(menu => { menu.open = false; });
      this.handleDisplayModeClick();
      return;
    }
    if (!this.quill) return;
    if (['undo', 'redo'].includes(button.dataset.action)) {
      this.quill.history?.[button.dataset.action]();
      this.syncToolbarState();
      return;
    }
    const status = this.editorToolbar.querySelector('.rich-text-toolbar-status');
    if (status) { status.hidden = true; status.textContent = ''; }
    const range = this.restoreEditorSelection();
    const current = this.quill.getFormat(range);
    this.quill.history?.cutoff();
    if (button.dataset.format) {
      const format = button.dataset.format;
      const explicit = Object.prototype.hasOwnProperty.call(button.dataset, 'value');
      const value = explicit ? (button.dataset.value || false) : current[format] !== true;
      this.quill.format(format, explicit && current[format] === value ? false : value, 'user');
      button.closest('.rich-text-toolbar-colour-menu')?.removeAttribute('open');
    } else if (button.dataset.list) {
      const list = button.dataset.list;
      this.quill.format('list', current.list === list ? false : list, 'user');
    } else if (button.dataset.insert) {
      this.insertTeachingMarkup(button.dataset.insert);
      this.editorToolbar.querySelectorAll('details[open]').forEach(menu => { menu.open = false; });
    } else if (button.dataset.action === 'clean') {
      this.clearSelectedFormatting(range);
    } else if (button.dataset.action === 'columns') {
      this.insertColumns();
    } else if (button.dataset.action === 'link') {
      const url = window.prompt('Paste a website or email link. Leave blank to remove a link.', typeof current.link === 'string' ? current.link : '');
      if (url !== null) {
        const input = url.trim();
        const normalized = !input ? false : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) ? `mailto:${input}`
          : /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
        const valid = !normalized || /^(https?:\/\/|mailto:|tel:)/i.test(normalized);
        if (valid) { this.restoreEditorSelection(); this.quill.format('link', normalized, 'user'); }
        else if (status) { status.hidden = false; status.textContent = 'Use a website, email address or telephone link.'; }
      }
    }
    this.quill.history?.cutoff();
    this.syncToolbarState();
  }

  clearSelectedFormatting(range) {
    let span = range;
    if (!span.length) {
      const [line, offset] = this.quill.getLine(span.index);
      span = { index: span.index - offset, length: line?.length() || 1 };
    }
    const Delta = window.Quill.import('delta');
    let change = new Delta().retain(span.index);
    const textFormats = new Set(['bold', 'italic', 'underline', 'strike', 'font', 'size', 'color', 'background', 'link', 'script', 'code', 'header', 'list', 'indent', 'align', 'lineSpacing', 'blockquote', 'code-block', 'displayCallout']);
    for (const op of this.quill.getContents(span.index, span.length).ops) {
      const attributes = typeof op.insert === 'string'
        ? Object.fromEntries(Object.keys(op.attributes || {}).filter(key => textFormats.has(key)).map(key => [key, null])) : {};
      change = change.retain(typeof op.insert === 'string' ? op.insert.length : 1, attributes);
    }
    // Retain embeds such as pictures while removing their text formatting.
    this.quill.updateContents(change, 'user');
    this.quill.formatLine(span.index, span.length, { header: false, list: false, indent: false, align: false, lineSpacing: false, blockquote: false, 'code-block': false }, 'user');
    this.quill.setSelection(range.index, range.length, 'silent');
  }

  syncToolbarState() {
    if (!this.quill || !this.editorToolbar) {
      return;
    }

    const remembered = this.quill.getSelection() || this.lastEditorSelection || { index: 0, length: 0 };
    const index = Math.max(0, Math.min(remembered.index, this.quill.getLength() - 1));
    const range = { index, length: Math.min(remembered.length, this.quill.getLength() - index) };
    const current = this.quill.getFormat(range);
    this.editorToolbar.querySelectorAll('select[data-format]').forEach((select) => {
      const format = select.dataset.format;
      const value = current[format];
      if (format === 'header' && !value && current.size === 'small') {
        select.value = 'small';
      } else {
        select.value = value === true || value == null ? '' : String(value);
      }
    });

    this.editorToolbar.querySelectorAll('button[data-format]').forEach((button) => {
      const format = button.dataset.format;
      const hasExplicitValue = Object.prototype.hasOwnProperty.call(button.dataset, 'value');
      const expectedValue = hasExplicitValue ? (button.dataset.value || false) : true;
      const active = expectedValue === false ? !current[format] : current[format] === expectedValue;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    this.editorToolbar.querySelectorAll('button[data-list]').forEach((button) => {
      const active = current.list === button.dataset.list;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    this.editorToolbar.querySelectorAll('[data-format-menu]').forEach((menu) => {
      const format = menu.dataset.formatMenu;
      const activeValue = typeof current[format] === 'string' ? current[format] : '';
      const preview = menu.querySelector('.rich-text-colour-preview');
      preview?.style.setProperty('--swatch-color', activeValue || (format === 'color' && this.instructionAppearance ? '#ffffff' : menu.dataset.defaultValue));
      menu.classList.toggle('is-active', !!activeValue);
    });

    const history = this.quill.history?.stack;
    this.editorToolbar.querySelector('[data-action="undo"]')?.toggleAttribute('disabled', !(history?.undo?.length));
    this.editorToolbar.querySelector('[data-action="redo"]')?.toggleAttribute('disabled', !(history?.redo?.length));
  }

  handleDisplayModeClick() {
    this.isDisplayMode = !this.isDisplayMode;
    this.updateDisplayModeUI();
    window.TeacherScreenWidgetState.notifyChanged(this, 'display-mode-updated');
  }

  enterPresentationMode() {
    this.presentationMode = 'fullscreen';
    this.isDisplayMode = true;
    this.updateDisplayModeUI();
    window.TeacherScreenWidgetState.notifyChanged(this, 'presentation-mode-updated');
  }

  exitPresentationMode() {
    if (!this.isDisplayMode || this.presentationMode !== 'fullscreen') {
      return;
    }

    this.presentationMode = 'normal';
    this.isDisplayMode = false;
    this.updateDisplayModeUI();
    this.quill?.focus();
    window.TeacherScreenWidgetState.notifyChanged(this, 'presentation-mode-updated');
  }

  handleDocumentKeydown(event) {
    if (event.key !== 'Escape' || this.isProjectorMode()) {
      return;
    }

    if (this.isDisplayMode && this.presentationMode === 'fullscreen') {
      event.preventDefault();
      this.exitPresentationMode();
    }
  }

  handleInlineEditClick() {
    if (!this.isDisplayMode) {
      return;
    }

    if (this.presentationMode === 'fullscreen') {
      this.exitPresentationMode();
      return;
    }

    this.isDisplayMode = false;
    this.updateDisplayModeUI();
    this.quill?.focus();
    window.TeacherScreenWidgetState.notifyChanged(this, 'display-mode-updated');
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
      this.updateHeaderTitle();
      return;
    }

    this.quill.setContents([], 'silent');
    this.quill.clipboard.dangerouslyPasteHTML(0, html);
    this.quill.setSelection(this.quill.getLength(), 0, 'silent');
    this.pendingContent = this.quill.root.innerHTML;
    this.updateHeaderTitle();
    window.TeacherScreenWidgetState.notifyChanged(this, 'template-loaded');
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
    window.TeacherScreenWidgetState.notifyChanged(this, 'presentation-mode-updated');
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
    this.updateHeaderTitle();
    this.syncToolbarState();
    window.TeacherScreenWidgetState.notifyChanged(this, 'content-updated');
  }

  insertHtml(html) {
    if (!this.quill || !html) return;
    const range = this.restoreEditorSelection();
    const before = this.quill.getLength();
    this.quill.history?.cutoff();
    this.isApplyingSmartFormatting = true;
    try { this.quill.clipboard.dangerouslyPasteHTML(range.index, html, 'user'); }
    finally { this.isApplyingSmartFormatting = false; }
    const inserted = this.quill.getLength() - before;
    this.quill.setSelection(Math.min(this.quill.getLength() - 1, range.index + inserted), 0, 'silent');
    this.quill.history?.cutoff();
  }

  insertColumns() {
    if (!this.quill) return;
    this.restoreEditorSelection();
    this.quill.history?.cutoff();
    this.quill.getModule('table')?.insertTable(2, 2);
    this.quill.history?.cutoff();
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

  getTeachingMarkup(key) {
    const blocks = {
      'learning-intention': `
        <h2>Learning Intention</h2>
        <div class="display-callout"><p><strong>Today we are learning to…</strong></p><p>Describe the key knowledge or skill for this lesson.</p></div>
      `,
      'success-criteria': `
        <h2>Success Criteria</h2>
        <ul><li>I can explain…</li><li>I can apply…</li><li>I can check…</li></ul>
      `,
      'warm-up': `
        <h2>Warm-up</h2>
        <div class="display-callout"><p><strong>5 minutes</strong></p><p>Start with this short retrieval or thinking task.</p></div>
      `,
      'discussion-question': `
        <h2>Discussion Question</h2>
        <div class="display-callout"><p><strong>Talk with a partner</strong></p><p>What do you notice, wonder, or predict?</p></div>
      `,
      'exit-ticket': `
        <h2>Exit Ticket</h2>
        <ol><li>What is one thing you learned?</li><li>What is one question you still have?</li></ol>
      `,
      tip: '<div class="display-callout"><p><strong>&#128161; Tip</strong></p><p>A helpful idea for tackling this task.</p></div>',
      remember: '<div class="display-callout"><p><strong>&#11088; Remember</strong></p><p>The key point students should keep in mind.</p></div>',
      important: '<div class="display-callout"><p><strong>&#9888;&#65039; Important</strong></p><p>Pause and make sure this detail is understood.</p></div>',
      question: '<div class="display-callout"><p><strong>&#10067; Question</strong></p><p>Ask students to explain their thinking.</p></div>',
      answer: '<div class="display-callout"><p><strong>&#9989; Answer</strong></p><p>Reveal or discuss the model response here.</p></div>'
    };

    return blocks[key] || '';
  }

  insertTeachingMarkup(key) {
    const markup = this.getTeachingMarkup(key);
    if (!markup) {
      return;
    }

    this.insertHtml(`${markup}<p><br></p>`);
  }

  insertTemplate(templateKey) {
    if (!this.quill) {
      return;
    }

    const html = this.getTemplateMarkup(templateKey);
    if (!html) {
      return;
    }

    this.insertHtml(html);
  }

  serialize() {
    return {
      ...(this.teacherOnly ? { teacherOnly: true } : {}),
      customTitle: this.customTitle,
      showOnEveryPage: this.showOnEveryPage,
      keepInFront: this.keepInFront,
      instructionAppearance: this.instructionAppearance,
      instructionFontSize: this.instructionFontSize,
      content: this.quill ? this.quill.root.innerHTML : this.pendingContent,
      displayMode: this.isDisplayMode,
      presentationMode: this.presentationMode
    };
  }

  deserialize(data) {
    this.teacherOnly = data?.teacherOnly === true;
    this.showOnEveryPage = data?.showOnEveryPage === true;
    this.keepInFront = data?.keepInFront === true;
    this.instructionAppearance = data?.instructionAppearance === true;
    this.instructionFontSize = Math.max(20, Math.min(48, Number(data?.instructionFontSize) || 28));
    this.customTitle = typeof data?.customTitle === 'string' ? data.customTitle.trim().replace(/\s+/gu, ' ').slice(0, 80) : '';
    this.pendingContent = data?.content || '';
    this.isDisplayMode = data?.displayMode === true;
    this.presentationMode = data?.presentationMode || 'normal';
    this.element.classList.toggle('display-mode', this.isDisplayMode);
    this.element.classList.toggle('is-projector-mode', this.isProjectorMode());
    this.updateDisplayModeUI();

    if (this.quill) {
      this.quill.root.innerHTML = this.pendingContent;
      this.syncEditorLayout();
    } else {
      this.editorSurface.innerHTML = this.pendingContent;
    }
    this.updateHeaderTitle();
  }

  serializeForProjector() {
    return this.teacherOnly
      ? { content: '', customTitle: '', displayMode: true, presentationMode: 'normal', teacherOnly: true }
      : this.serialize();
  }

  onWidgetLayout() {
    this.syncEditorLayout();
  }

  syncEditorLayout() {
    if (!this.editorContainer) {
      return;
    }

    const toolbar = this.editorContainer.querySelector('.rich-text-editor-toolbar, .ql-toolbar');
    const editorShell = this.editorContainer.querySelector('.ql-container')
      || this.editorContainer.querySelector('.rich-text-editor-fallback');
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
    this.scheduleProjectorAutoFit();
  }

  scheduleProjectorAutoFit() {
    if (!this.autoFitTimer) {
      this.autoFitTimer = setTimeout(() => {
        this.autoFitTimer = null;
        this.fitProjectorContent();
      }, 350);
    }

    if (this.autoFitFrame) {
      return;
    }

    this.autoFitFrame = requestAnimationFrame(() => {
      this.autoFitFrame = null;
      this.fitProjectorContent();
    });
  }

  fitProjectorContent() {
    if (this.instructionAppearance) return;
    const editor = this.quill?.root
      || (this.editorSurface.matches('.ql-editor') ? this.editorSurface : this.editorSurface.querySelector('.ql-editor'));
    if (!editor || !this.isProjectorMode() || editor.clientHeight <= 0) {
      this.element.style.removeProperty('--rich-text-projector-fit');
      this.element.style.removeProperty('--rich-text-projector-font-size');
      return;
    }

    const minimumScale = 0.62;
    const baseFontSize = this.presentationMode === 'large' ? 1.65 : 1.35;
    const fits = (scale) => {
      this.element.style.setProperty('--rich-text-projector-fit', scale.toFixed(3));
      this.element.style.setProperty('--rich-text-projector-font-size', `${(baseFontSize * scale).toFixed(3)}rem`);
      window.getComputedStyle(editor).fontSize;
      return editor.scrollHeight <= editor.clientHeight + 2;
    };

    if (fits(1)) {
      return;
    }

    let low = minimumScale;
    let high = 1;
    if (!fits(low)) {
      return;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = (low + high) / 2;
      if (fits(candidate)) {
        low = candidate;
      } else {
        high = candidate;
      }
    }
    fits(low);
  }

  updateDisplayModeUI() {
    for (const [key, input] of Object.entries(this.scopeInputs || {})) input.checked = this[key] === true;
    this.element.classList.toggle('instruction-appearance', this.instructionAppearance);
    this.element.style.setProperty('--instruction-board-font-size', `${this.instructionFontSize}px`);
    this.element.classList.toggle('is-projector-mode', this.isProjectorMode());
    this.element.classList.toggle('display-mode', this.isDisplayMode);
    this.element.dataset.presentationMode = this.presentationMode;
    this.displayModeButton.textContent = this.isDisplayMode ? 'Edit' : 'Display';
    this.displayModeButton.setAttribute('aria-pressed', this.isDisplayMode ? 'true' : 'false');

    const isPresenting = this.isDisplayMode && this.presentationMode === 'fullscreen';
    if (!this.isProjectorMode()) {
      const hasActivePresentation = document.querySelector(
        '.rich-text-widget-inner.display-mode[data-presentation-mode="fullscreen"]:not(.is-projector-mode)'
      );
      document.body?.classList.toggle('rich-text-presenting', !!hasActivePresentation);
    }

    if (this.inlineEditButton) {
      this.inlineEditButton.textContent = isPresenting ? 'Exit Present' : 'Edit';
      this.inlineEditButton.title = isPresenting ? 'Exit presentation mode (Esc)' : 'Show text toolbar';
      this.inlineEditButton.setAttribute('aria-label', isPresenting ? 'Exit presentation mode' : 'Show text toolbar');
      this.inlineEditButton.toggleAttribute('aria-keyshortcuts', isPresenting);
      if (isPresenting) {
        this.inlineEditButton.setAttribute('aria-keyshortcuts', 'Escape');
      }
      this.inlineEditButton.classList.toggle('rich-text-inline-edit-button--exit', isPresenting);
    }

    const modeLabels = {
      normal: 'Normal display layout',
      large: 'Large text display layout',
      focus: 'Focused reading layout',
      fullscreen: 'Full screen display layout'
    };

    this.modeButtons.forEach((button) => {
      const isActive = button.dataset.mode === this.presentationMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (this.modeHint) {
      this.modeHint.textContent = this.isDisplayMode
        ? modeLabels[this.presentationMode] || modeLabels.normal
        : 'Choose a display size, then switch to Display when you want a read-only class view.';
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
    } else {
      if (this.editorSurface?.classList.contains('rich-text-editor-fallback')) {
        this.editorSurface.contentEditable = String(!this.isProjectorMode() && !this.isDisplayMode);
      }
      this.scheduleProjectorAutoFit();
    }
  }

  onLayoutDiscard() { this.remove({ notify: false }); }

  remove({ notify = true } = {}) {
    document.removeEventListener('keydown', this.handleDocumentKeydown);
    if (this.isDisplayMode && this.presentationMode === 'fullscreen') {
      document.body?.classList.remove('rich-text-presenting');
    }
    this.displayModeButton.removeEventListener('click', this.handleDisplayModeClick);
    this.inlineEditButton?.removeEventListener('click', this.handleInlineEditClick);
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

    if (this.autoFitFrame) {
      cancelAnimationFrame(this.autoFitFrame);
      this.autoFitFrame = null;
    }

    if (this.autoFitTimer) {
      clearTimeout(this.autoFitTimer);
      this.autoFitTimer = null;
    }

    if (this.quill && typeof this.quill.off === 'function') {
      this.quill.off('text-change', this.handleTextChange);
      this.quill.off('selection-change', this.handleEditorSelectionChange);
    }

    if (this.editorToolbar) {
      this.editorToolbar.removeEventListener('change', this.handleEditorToolbarChange);
      this.editorToolbar.removeEventListener('click', this.handleEditorToolbarClick);
      this.editorToolbar.removeEventListener('pointerdown', this.handleEditorToolbarPointerDown);
    }

    if (this.templateDialog) {
      this.templateDialog.remove();
      this.templateDialog = null;
    }
    this.templateDialogSubmitHandler = null;

    this.quill = null;
    this.element.remove();

    if (notify) {
      const event = new CustomEvent('widgetRemoved', { detail: { widget: this } });
      document.dispatchEvent(event);
    }
  }
}
