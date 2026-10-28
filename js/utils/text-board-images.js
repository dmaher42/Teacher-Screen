(function (global) {
    'use strict';

    const percent = value => Math.max(1, Math.min(100, Math.round(Number(value) * 10) / 10));

    class TextBoardImageControls {
        constructor(widget) {
            this.widget = widget;
            this.quill = widget.quill;
            this.root = this.quill.root;
            this.doc = this.root.ownerDocument;
            this.win = this.doc.defaultView;
            this.listeners = [];
            this.image = null;
            this.drag = null;
            this.host = this.doc.createElement('div');
            this.host.className = 'text-board-image-overlay';
            this.host.hidden = true;
            this.host.innerHTML = `<div class="text-board-image-frame"></div>
                <div class="text-board-image-size" role="group" aria-label="Image size">
                    <label>Width <input type="number" min="1" max="100" step="0.1" aria-label="Image width percent">%</label>
                    <button type="button" data-image-size="fit">Fit width</button>
                    <button type="button" data-image-size="original">Original</button>
                </div>`;
            this.frame = this.host.querySelector('.text-board-image-frame');
            this.tools = this.host.querySelector('.text-board-image-size');
            this.input = this.host.querySelector('input');
            for (const [corner, label] of [['nw', 'top left'], ['ne', 'top right'], ['sw', 'bottom left'], ['se', 'bottom right']]) {
                const handle = this.doc.createElement('button');
                handle.type = 'button';
                handle.className = `text-board-image-handle text-board-image-handle--${corner}`;
                handle.dataset.imageCorner = corner;
                handle.setAttribute('aria-label', `Resize image from ${label}`);
                this.frame.append(handle);
            }
            widget.editorContainer.append(this.host);
            this.listen(this.root, 'click', event => {
                const image = event.target.closest('img');
                if (image && this.editable()) { event.preventDefault(); this.select(image); }
            });
            this.listen(this.doc, 'pointerdown', event => {
                if (!this.host.contains(event.target) && event.target !== this.image) this.clear();
            }, true);
            this.listen(this.root, 'keydown', event => {
                if (!this.image || !this.editable()) return;
                if (event.key === 'Tab' && !event.shiftKey) {
                    event.preventDefault(); event.stopPropagation(); this.input.focus();
                } else if (event.key === 'Escape') {
                    event.preventDefault(); event.stopPropagation(); this.clear();
                }
            });
            this.listen(this.host, 'keydown', event => {
                if (event.key === 'Escape') {
                    event.preventDefault(); event.stopPropagation(); this.clear(); this.quill.focus();
                } else if (event.target.dataset.imageCorner && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault(); event.stopPropagation();
                    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
                    this.commit(this.currentPercent() + direction * (event.shiftKey ? 10 : 1));
                } else if (event.target === this.input && event.key === 'Enter') {
                    event.preventDefault(); event.stopPropagation(); this.commit(this.input.value);
                }
            });
            this.listen(this.input, 'change', () => this.commit(this.input.value));
            this.listen(this.tools, 'click', event => {
                const action = event.target.closest('[data-image-size]')?.dataset.imageSize;
                if (action === 'fit') this.commit(100);
                if (action === 'original' && this.image?.naturalWidth) this.commit(this.image.naturalWidth / this.contentWidth() * 100);
            });
            this.listen(this.frame, 'pointerdown', event => this.beginDrag(event));
            this.listen(this.frame, 'pointermove', event => this.moveDrag(event));
            this.listen(this.frame, 'pointerup', event => this.endDrag(event, true));
            this.listen(this.frame, 'pointercancel', event => this.endDrag(event, false));
            this.listen(this.root, 'scroll', () => this.refresh());
            this.listen(this.root, 'load', () => this.refresh(), true);
            this.listen(this.win, 'resize', () => this.refresh());
            this.selectionChanged = (range, oldRange, source) => {
                if (source !== 'user' || range?.length !== 1 || !this.editable()) return;
                const [leaf] = this.quill.getLeaf(range.index);
                if (leaf?.domNode?.tagName === 'IMG') this.select(leaf.domNode);
            };
            this.quill.on('selection-change', this.selectionChanged);
            this.observer = new this.win.MutationObserver(() => this.refresh());
            this.observer.observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height', 'src'] });
            if (this.win.ResizeObserver) {
                this.resizeObserver = new this.win.ResizeObserver(() => this.refresh());
                this.resizeObserver.observe(widget.editorContainer);
            }
        }

        listen(target, name, callback, options) {
            target.addEventListener(name, callback, options);
            this.listeners.push(() => target.removeEventListener(name, callback, options));
        }

        editable() { return !this.widget.isProjectorMode() && !this.widget.isDisplayMode && this.root.isConnected; }

        contentWidth() {
            const style = this.win.getComputedStyle(this.root);
            return Math.max(1, this.root.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
        }

        currentPercent() { return percent(this.image.getBoundingClientRect().width / this.contentWidth() * 100); }

        select(image) {
            if (!this.editable() || !this.root.contains(image)) return;
            this.image = image;
            this.refresh();
        }

        clear() {
            if (this.drag) this.endDrag({ pointerId: this.drag.pointerId }, false);
            this.image = null;
            this.host.hidden = true;
        }

        refresh() {
            if (!this.image || !this.root.contains(this.image) || !this.editable()) { this.clear(); return; }
            if (this.drag) return;
            const image = this.image.getBoundingClientRect();
            this.host.hidden = image.width <= 0 || image.height <= 0;
            if (this.host.hidden) return;
            this.input.value = String(this.currentPercent());
            this.tools.querySelector('[data-image-size="original"]').disabled = !this.image.naturalWidth;
            this.position(image.width, image.height);
        }

        position(width, height) {
            const container = this.widget.editorContainer.getBoundingClientRect();
            const image = this.image.getBoundingClientRect();
            const left = image.left - container.left;
            const top = image.top - container.top;
            Object.assign(this.frame.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
            this.frame.classList.toggle('is-small', width < 88 || height < 88);
            const toolWidth = this.tools.offsetWidth;
            const toolHeight = this.tools.offsetHeight;
            Object.assign(this.tools.style, {
                left: `${Math.max(8, Math.min(left, container.width - toolWidth - 8))}px`,
                top: `${Math.max(4, Math.min(top + height + 8, container.height - toolHeight - 4))}px`
            });
        }

        commit(value) {
            if (!this.image || !this.editable() || value === '' || !Number.isFinite(Number(value))) { this.refresh(); return; }
            const blot = this.win.Quill.find(this.image);
            if (!blot) return;
            const index = this.quill.getIndex(blot);
            // One user format operation retains undo, clipboard formats and the existing HTML save/sync path.
            this.quill.history.cutoff();
            this.quill.formatText(index, 1, { width: `${percent(value)}%`, height: false }, 'user');
            this.quill.history.cutoff();
            this.refresh();
        }

        beginDrag(event) {
            const handle = event.target.closest('[data-image-corner]');
            if (this.drag || !handle || !this.image || !this.editable() || (event.button !== undefined && event.button !== 0)) return;
            event.preventDefault(); event.stopPropagation();
            const box = this.image.getBoundingClientRect();
            this.drag = { handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: box.width,
                ratio: this.image.naturalWidth && this.image.naturalHeight ? this.image.naturalWidth / this.image.naturalHeight : box.width / box.height,
                corner: handle.dataset.imageCorner, value: this.currentPercent() };
            handle.setPointerCapture?.(event.pointerId);
        }

        moveDrag(event) {
            if (!this.drag || event.pointerId !== this.drag.pointerId) return;
            event.preventDefault(); event.stopPropagation();
            const drag = this.drag;
            const dx = (event.clientX - drag.x) * (drag.corner.endsWith('e') ? 1 : -1);
            const dy = (event.clientY - drag.y) * (drag.corner.startsWith('s') ? 1 : -1) * drag.ratio;
            drag.value = percent((drag.width + (Math.abs(dx) > Math.abs(dy) ? dx : dy)) / this.contentWidth() * 100);
            const width = this.contentWidth() * drag.value / 100;
            this.input.value = String(drag.value);
            // Preview only in teacher chrome: autosave can never capture an unfinished drag.
            this.position(width, width / drag.ratio);
        }

        endDrag(event, save) {
            if (!this.drag || event.pointerId !== this.drag.pointerId) return;
            const drag = this.drag;
            this.drag = null;
            if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
            if (save) this.commit(drag.value);
            else this.refresh();
        }

        destroy() {
            this.clear();
            this.listeners.forEach(dispose => dispose());
            this.observer.disconnect();
            this.resizeObserver?.disconnect();
            this.quill.off('selection-change', this.selectionChanged);
            this.host.remove();
        }
    }

    const api = { percent, create: widget => widget.isProjectorMode() ? null : new TextBoardImageControls(widget) };
    global.TeacherScreenTextBoardImages = Object.freeze(api);
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
