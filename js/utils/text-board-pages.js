(function (global) {
    'use strict';
    const pageId = () => global.crypto?.randomUUID?.() || `slide-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    function normalize(data, fallback = '') {
        const ids = new Set();
        const pages = (Array.isArray(data?.pages) ? data.pages : []).map(value => {
            const page = typeof value === 'string' ? { content: value } : value || {};
            const id = typeof page.id === 'string' && page.id && !ids.has(page.id) ? page.id : pageId();
            ids.add(id);
            return { ...page, id, content: typeof page.content === 'string' ? page.content : '' };
        });
        if (!pages.length) pages.push({ id: pageId(), content: fallback });
        return { ...data, version: 1, pages, activePageId: pages.some(page => page.id === data?.activePageId) ? data.activePageId : pages[0].id };
    }

    class TextBoardPages {
        constructor(widget, data) {
            this.widget = widget;
            this.state = normalize(data, widget.quill?.root.innerHTML || widget.pendingContent || '');
            this.deleted = null;
            this.nav = widget.element.ownerDocument.createElement('div');
            this.nav.className = 'text-presentation-nav';
            this.nav.setAttribute('aria-label', 'Text presentation');
            this.nav.innerHTML = `<div class="text-presentation-pair" role="group" aria-label="Slide navigation">
                <button type="button" data-slide-action="previous" aria-label="Previous text slide"><span aria-hidden="true">&lsaquo;</span><span class="text-slide-label"> Previous</span></button>
                <button type="button" data-slide-action="next" aria-label="Next text slide"><span class="text-slide-label">Next </span><span aria-hidden="true">&rsaquo;</span></button>
                </div><select aria-label="Select text slide"></select>
                <details class="text-presentation-actions"><summary aria-label="Text slide actions">Pages</summary>
                    <div role="menu" aria-label="Text slide actions">
                        <button type="button" role="menuitem" data-slide-action="add">Add slide</button>
                        <button type="button" role="menuitem" data-slide-action="remove">Remove slide</button>
                        <button type="button" role="menuitem" data-slide-action="undo" hidden>Undo remove</button>
                    </div>
                </details><button type="button" data-slide-action="present">Present</button>`;
            widget.element.insertBefore(this.nav, widget.editorContainer);
            widget.element.classList.add('is-text-presentation');
            this.select = this.nav.querySelector('select');
            this.menu = this.nav.querySelector('details');
            this.onClick = event => {
                const action = event.target.closest('[data-slide-action]')?.dataset.slideAction;
                if (!action || widget.isProjectorMode()) return;
                if (action === 'previous') this.go(this.index() - 1);
                if (action === 'next') this.go(this.index() + 1);
                if (action === 'add') this.add();
                if (action === 'remove') this.remove();
                if (action === 'undo') this.undoRemove();
                if (action === 'present') { widget.enterPresentationMode(); this.render(); }
                if (['add', 'remove', 'undo'].includes(action)) this.menu.open = false;
            };
            this.onChange = () => this.go(this.state.pages.findIndex(page => page.id === this.select.value));
            this.onMenuKeydown = event => {
                if (event.key === 'Escape' && this.menu.open) {
                    event.preventDefault(); event.stopPropagation(); this.menu.open = false; this.menu.querySelector('summary').focus();
                    return;
                }
                const items = [...this.menu.querySelectorAll('button')].filter(button => !button.disabled && !button.hidden);
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                if (!this.menu.open && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
                event.preventDefault(); event.stopPropagation(); this.menu.open = true;
                const index = items.indexOf(this.nav.ownerDocument.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : event.key === 'ArrowDown' ? (index + 1) % items.length : index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
                items[next]?.focus();
            };
            this.nav.addEventListener('click', this.onClick);
            this.select.addEventListener('change', this.onChange);
            this.menu.addEventListener('keydown', this.onMenuKeydown);
            this.onKeydown = event => this.handleKeydown(event);
            widget.element.addEventListener('keydown', this.onKeydown);
            this.show();
        }

        index() { return this.state.pages.findIndex(page => page.id === this.state.activePageId); }
        active() { return this.state.pages[this.index()]; }
        capture() {
            const page = this.active();
            if (page) page.content = this.widget.quill?.root.innerHTML ?? this.widget.pendingContent;
        }

        show() {
            const widget = this.widget;
            widget.imageControls?.clear();
            widget.pendingContent = this.active().content;
            if (widget.quill) {
                widget.quill.setContents(widget.quill.clipboard.convert({ html: widget.pendingContent }), 'silent');
                widget.quill.history.clear();
                widget.quill.root.setAttribute('data-placeholder', '');
                widget.lastEditorSelection = null;
            } else widget.editorSurface.innerHTML = widget.pendingContent;
            this.render();
            widget.updateHeaderTitle();
            widget.syncEditorLayout();
        }

        editorReady() {
            this.widget.quill.root.setAttribute('data-placeholder', '');
            this.widget.quill.update('silent');
            this.widget.quill.history.clear();
            this.render();
        }

        notify() { global.TeacherScreenWidgetState.notifyChanged(this.widget, 'text-presentation-updated'); }

        go(index) {
            if (this.widget.isProjectorMode() || !Number.isInteger(index) || index < 0 || index >= this.state.pages.length || index === this.index()) return;
            this.capture();
            this.state.activePageId = this.state.pages[index].id;
            this.show(); this.notify();
        }

        add() {
            if (this.widget.isProjectorMode() || this.widget.isDisplayMode) return;
            this.capture();
            const page = { id: pageId(), content: '' };
            this.state.pages.splice(this.index() + 1, 0, page);
            this.state.activePageId = page.id;
            this.show(); this.notify();
            this.widget.quill?.focus();
        }

        remove() {
            if (this.widget.isProjectorMode() || this.widget.isDisplayMode || this.state.pages.length === 1) return;
            if (!global.confirm(`Remove slide ${this.index() + 1}?`)) return;
            this.capture();
            const index = this.index();
            this.deleted = { page: this.state.pages.splice(index, 1)[0], index };
            this.state.activePageId = this.state.pages[Math.min(index, this.state.pages.length - 1)].id;
            this.show(); this.notify();
        }

        undoRemove() {
            if (!this.deleted || this.widget.isProjectorMode() || this.widget.isDisplayMode) return;
            this.capture();
            this.state.pages.splice(this.deleted.index, 0, this.deleted.page);
            this.state.activePageId = this.deleted.page.id;
            this.deleted = null;
            this.show(); this.notify();
        }

        render() {
            const doc = this.nav.ownerDocument;
            this.nav.hidden = this.widget.isProjectorMode();
            this.select.replaceChildren(...this.state.pages.map((page, index) => {
                const option = doc.createElement('option');
                option.value = page.id; option.textContent = `Slide ${index + 1} of ${this.state.pages.length}`;
                return option;
            }));
            this.select.value = this.state.activePageId;
            this.nav.querySelector('[data-slide-action="previous"]').disabled = this.index() === 0;
            this.nav.querySelector('[data-slide-action="next"]').disabled = this.index() === this.state.pages.length - 1;
            this.nav.querySelector('[data-slide-action="remove"]').disabled = this.state.pages.length === 1;
            this.nav.querySelector('[data-slide-action="undo"]').hidden = !this.deleted;
            this.menu.hidden = this.widget.isDisplayMode;
            this.nav.querySelector('[data-slide-action="present"]').hidden = this.widget.isDisplayMode;
        }

        handleKeydown(event) {
            if (!this.widget.isDisplayMode || this.widget.isProjectorMode()) return false;
            if (!this.widget.element.contains(event.target) || event.target.closest('input, textarea, select, [contenteditable="true"], details[open], dialog')) return false;
            const direction = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[event.key];
            if (!direction) return false;
            event.preventDefault(); event.stopPropagation(); this.go(this.index() + direction); return true;
        }

        serialize() {
            this.capture();
            return { ...this.state, pages: this.state.pages.map(page => ({ ...page })) };
        }

        destroy() {
            this.nav.removeEventListener('click', this.onClick);
            this.select.removeEventListener('change', this.onChange);
            this.menu.removeEventListener('keydown', this.onMenuKeydown);
            this.widget.element.removeEventListener('keydown', this.onKeydown);
            this.nav.remove();
            this.widget.element.classList.remove('is-text-presentation');
        }
    }

    const api = { normalize, create: (widget, data) => new TextBoardPages(widget, data) };
    global.TeacherScreenTextBoardPages = Object.freeze(api);
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
