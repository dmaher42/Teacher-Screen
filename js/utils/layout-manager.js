// js/utils/layout-manager.js

const GRID_SIZE = 20; // Widgets will snap to a 20px grid
const COL_PX_ESTIMATE = 80; // Rough estimate for legacy constraint conversion
const TEACHER_CANVAS_MARGIN = 16;
const TEACHER_CANVAS_BOTTOM_INSET = 0;
const TEACHER_TOOLBAR_GAP = TEACHER_CANVAS_MARGIN;
const TEACHER_WIDGET_GAP = GRID_SIZE;
const MINIMIZED_WIDGET_HEIGHT = GRID_SIZE * 2;
const layoutManagerIsTeacherMode = () => (window.TeacherScreenAppMode ? window.TeacherScreenAppMode.isTeacherMode() : true);
const layoutManagerApplyAppModeToWidget = (widgetInstance) => (window.TeacherScreenAppMode && typeof window.TeacherScreenAppMode.applyAppModeToWidget === 'function'
  ? window.TeacherScreenAppMode.applyAppModeToWidget(widgetInstance)
  : widgetInstance);
const layoutManagerEventBus = window.TeacherScreenEventBus ? window.TeacherScreenEventBus.eventBus : null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}


function safeParseLocalStorage(key) {
  try {
    const value = localStorage.getItem(key);
    if (!value) return null;
    return JSON.parse(value);
  } catch (error) {
    console.warn('Invalid localStorage data detected for:', key);
    localStorage.removeItem(key);
    return null;
  }
}

function isValidLayout(layout) {
  if (!layout || typeof layout !== 'object') return false;
  if (!['dashboard', 'stage'].includes(layout.mode)) return false;
  if (!Array.isArray(layout.widgets)) return false;

  for (const widget of layout.widgets) {
    if (!widget || typeof widget !== 'object') return false;
    if (typeof widget.id !== 'string') return false;
    if (typeof widget.type !== 'string') return false;
    if (typeof widget.x !== 'number') return false;
    if (typeof widget.y !== 'number') return false;
    if (typeof widget.width !== 'number') return false;
    if (typeof widget.height !== 'number') return false;
  }

  return true;
}

const WIDGET_SIZE_RULES = {
  PomodoroWidget: { minW: 2, minH: 0.75, minWidthPx: 160, minHeightPx: 80, defaultW: 2, defaultH: 0.75, maxW: 12, maxH: 5 },
  TimerWidget: { minW: 2, minH: 0.75, minWidthPx: 160, minHeightPx: 80, defaultW: 2, defaultH: 0.75, maxW: 12, maxH: 5 },
  BehaviourTrackerWidget: { minW: 4, minH: 4, defaultW: 5, defaultH: 5 },
  NoiseMeterWidget: { minW: 2.5, minH: 1.25, defaultW: 3, defaultH: 1.5 },
  QRCodeWidget: { minW: 4, minH: 4, defaultW: 4, defaultH: 5 },
  DrawingToolWidget: { minW: 5, minH: 4, defaultW: 5, defaultH: 4 },
  QuizGameWidget: { minW: 5, minH: 4, defaultW: 6, defaultH: 6 },
  DocumentViewerWidget: { minW: 6, minH: 5, defaultW: 8, defaultH: 6 },
  UrlViewerWidget: { minW: 6, minH: 5, defaultW: 8, defaultH: 6 },
  // Reveal manager uses standard grid sizing.
  RevealManagerWidget: { minW: 5, minH: 5, defaultW: 7, defaultH: 6, maxW: 12, maxH: 12 },
  NamePickerWidget: { minW: 4, minH: 3, defaultW: 4, defaultH: 3 },
  WellbeingWidget: { minW: 5, minH: 5, defaultW: 5, defaultH: 5 },
  RichTextWidget: { minW: 4, minH: 3, defaultW: 5, defaultH: 4 },
  MaskWidget: { minW: 4, minH: 3, defaultW: 4, defaultH: 3 },
  NotesWidget: { minW: 5, minH: 4, defaultW: 5, defaultH: 4 }
};

const WIDGET_DISPLAY_NAMES = {
  BehaviourTrackerWidget: 'Learning-Time Tracker',
  PomodoroWidget: 'Timer',
  RevealManagerWidget: 'Presentation',
  RichTextWidget: 'Text Board',
  UrlViewerWidget: 'Web Page'
};

class LayoutManager {
  constructor(container) {
    this.container = container;
    this.mode = 'dashboard';
    this.editable = false;
    this.widgets = [];
    // Keep these for legacy reference, though we are free-form now
    this.gridColumns = 12;
    this.gridRows = 8;
    this.draggedWidget = null;
    this.onLayoutChange = null;
    this.isRestoring = false;
    this.interactionEnabled = true;
    this.containerResizeObserver = null;
    this.lastContainerSize = null;
    this.selectedWidgetElement = null;
    this.widgetSelectionListenersBound = false;

    if (typeof debounce === 'function') {
        this.saveLayout = debounce(this.saveLayout.bind(this), 200);
    } else {
        const localDebounce = (fn, delay = 250) => {
            let timer = null;
            return function (...args) {
                clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        };
        this.saveLayout = localDebounce(this.saveLayout.bind(this), 200);
    }
  }

  setInteractionEnabled(enabled) {
    this.setEditable(enabled);
  }

  setEditable(isEditable) {
    this.editable = !!isEditable;
    this.interactionEnabled = this.editable;
    this.container.classList.toggle('layout-edit-mode', this.editable);
    this.container.dataset.layoutMode = this.editable ? 'arrange' : 'teach';
    if (!this.editable) {
      this.setSelectedWidgetElement(null);
    }
    this.widgets.forEach((widgetInfo) => {
      this.updateWidgetChrome(widgetInfo);
      if (widgetInfo.widget && typeof widgetInfo.widget.setEditable === 'function') {
        widgetInfo.widget.setEditable(this.editable);
      }
    });
  }

  init() {
    this.applyGridStyles();
    this.bindWidgetSelectionListeners();
    window.addEventListener('resize', () => {
      this.clampAllWidgetsToContainer();
      this.saveLayout({ emitFull: false });
    });

    if (typeof ResizeObserver === 'function') {
      this.containerResizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;

        const nextSize = {
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height)
        };
        if (this.lastContainerSize
          && this.lastContainerSize.width === nextSize.width
          && this.lastContainerSize.height === nextSize.height) {
          return;
        }

        const previousSize = this.lastContainerSize;
        this.lastContainerSize = nextSize;
        if (previousSize && previousSize.width > 0 && previousSize.height > 0) {
          this.scaleWidgetsToContainer(previousSize, nextSize);
        }
        this.clampAllWidgetsToContainer();
        this.saveLayout({ emitFull: false });
      });
      this.containerResizeObserver.observe(this.container);
    }
  }

  applyGridStyles() {
    // Switch to absolute positioning layout
    this.container.style.display = 'block';
    this.container.style.position = 'relative';
    this.container.style.height = '100%';
    this.container.style.overflow = 'hidden';
    // Remove grid properties
    this.container.style.gridTemplateColumns = '';
    this.container.style.gridTemplateRows = '';
    this.container.style.gap = '';
    this.container.style.padding = '0';
  }

  getCanvasMetrics() {
    const rawWidth = this.container.clientWidth || 1024;
    const rawHeight = this.container.clientHeight || 768;
    const isTeacherCanvas = layoutManagerIsTeacherMode();
    const margin = isTeacherCanvas ? TEACHER_CANVAS_MARGIN : 0;
    const bottomInset = isTeacherCanvas ? TEACHER_CANVAS_BOTTOM_INSET : 0;
    const width = Math.max(GRID_SIZE * 4, rawWidth - (margin * 2));
    const height = Math.max(GRID_SIZE * 4, rawHeight - (margin * 2) - bottomInset);

    return {
      rawWidth,
      rawHeight,
      margin,
      bottomInset,
      width,
      height,
      minX: margin,
      minY: margin
    };
  }

  getTeacherToolbarObstacle() {
    if (!layoutManagerIsTeacherMode() || !this.container?.isConnected) return null;

    const toolbar = document.getElementById('lesson-quick-actions');
    if (!toolbar) return null;

    const toolbarStyle = window.getComputedStyle(toolbar);
    if (toolbarStyle.display === 'none' || toolbarStyle.visibility === 'hidden') return null;

    const containerRect = this.container.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    if (containerRect.width <= 0 || containerRect.height <= 0
      || toolbarRect.width <= 0 || toolbarRect.height <= 0) {
      return null;
    }

    return {
      left: toolbarRect.left - containerRect.left,
      top: toolbarRect.top - containerRect.top,
      right: toolbarRect.right - containerRect.left,
      bottom: toolbarRect.bottom - containerRect.top
    };
  }

  keepWidgetClearOfTeacherToolbar(bounds, canvas, toolbarObstacle = this.getTeacherToolbarObstacle()) {
    if (!toolbarObstacle) return bounds;

    const overlapsToolbarHorizontally = bounds.x + bounds.width > toolbarObstacle.left - TEACHER_TOOLBAR_GAP
      && bounds.x < toolbarObstacle.right + TEACHER_TOOLBAR_GAP;
    const overlapsToolbarVertically = bounds.y + bounds.height > toolbarObstacle.top - TEACHER_TOOLBAR_GAP
      && bounds.y < toolbarObstacle.bottom + TEACHER_TOOLBAR_GAP;

    if (!overlapsToolbarHorizontally || !overlapsToolbarVertically) return bounds;

    const highestSafeY = toolbarObstacle.top - TEACHER_TOOLBAR_GAP - bounds.height;

    if (highestSafeY >= canvas.minY) {
      return {
        ...bounds,
        y: Math.min(bounds.y, highestSafeY)
      };
    }

    const maximumCanvasX = canvas.minX + Math.max(0, canvas.width - bounds.width);
    const sideCandidates = [
      toolbarObstacle.left - TEACHER_TOOLBAR_GAP - bounds.width,
      toolbarObstacle.right + TEACHER_TOOLBAR_GAP
    ]
      .filter((candidateX) => candidateX >= canvas.minX && candidateX <= maximumCanvasX)
      .sort((a, b) => Math.abs(a - bounds.x) - Math.abs(b - bounds.x));

    if (sideCandidates.length > 0) {
      return {
        ...bounds,
        x: sideCandidates[0]
      };
    }

    const maximumHeightAboveToolbar = Math.max(
      GRID_SIZE * 4,
      toolbarObstacle.top - TEACHER_TOOLBAR_GAP - canvas.minY
    );

    return {
      ...bounds,
      y: canvas.minY,
      height: Math.min(bounds.height, maximumHeightAboveToolbar)
    };
  }

  scaleWidgetsToContainer(previousSize, nextSize) {
    if (!previousSize || !nextSize || !this.widgets.length) return;

    const isTeacherCanvas = layoutManagerIsTeacherMode();
    const margin = isTeacherCanvas ? TEACHER_CANVAS_MARGIN : 0;
    const bottomInset = isTeacherCanvas ? TEACHER_CANVAS_BOTTOM_INSET : 0;
    const previousWidth = Math.max(GRID_SIZE * 4, previousSize.width - (margin * 2));
    const previousHeight = Math.max(GRID_SIZE * 4, previousSize.height - (margin * 2) - bottomInset);
    const nextWidth = Math.max(GRID_SIZE * 4, nextSize.width - (margin * 2));
    const nextHeight = Math.max(GRID_SIZE * 4, nextSize.height - (margin * 2) - bottomInset);
    const gapBudget = isTeacherCanvas ? Math.max(0, this.widgets.length - 1) * TEACHER_WIDGET_GAP : 0;
    const previousScalableWidth = Math.max(GRID_SIZE * 4, previousWidth - gapBudget);
    const nextScalableWidth = Math.max(GRID_SIZE * 4, nextWidth - gapBudget);
    const positionWidthScale = nextWidth / previousWidth;
    const widthScale = nextScalableWidth / previousScalableWidth;
    const heightScale = nextHeight / previousHeight;

    if (!Number.isFinite(positionWidthScale) || !Number.isFinite(widthScale) || !Number.isFinite(heightScale)) return;

    this.widgets.forEach((widgetInfo) => {
      const isMinimized = this.isWidgetMinimized(widgetInfo);
      const expandedHeight = isMinimized && Number.isFinite(widgetInfo.expandedHeight)
        ? widgetInfo.expandedHeight
        : widgetInfo.height;
      const scaledWidth = widgetInfo.width * widthScale;
      const scaledHeight = expandedHeight * heightScale;
      const constrained = this.getConstrainedSize(widgetInfo.widget, scaledWidth, scaledHeight);
      widgetInfo.x = margin + ((widgetInfo.x - margin) * positionWidthScale);
      widgetInfo.y = margin + ((widgetInfo.y - margin) * heightScale);
      widgetInfo.width = constrained.width;
      widgetInfo.expandedHeight = constrained.height;
      widgetInfo.height = isMinimized ? MINIMIZED_WIDGET_HEIGHT : constrained.height;
    });
  }

  clearStageLayout() {
    this.stageContainer = null;
    this.stageMain = null;
    this.stageSidebar = null;
  }

  setupModeStructure() {
    this.container.innerHTML = '';
    this.clearStageLayout();

    if (this.mode !== 'stage') {
      this.applyGridStyles();
      return;
    }

    this.container.style.display = 'block';
    this.container.style.position = 'relative';
    this.container.style.height = '100%';
    this.container.style.overflow = 'hidden';

    this.stageContainer = document.createElement('div');
    this.stageContainer.className = 'layout-stage-container';
    this.stageMain = document.createElement('div');
    this.stageMain.className = 'layout-stage-main';
    this.stageSidebar = document.createElement('div');
    this.stageSidebar.className = 'layout-stage-sidebar';

    this.stageContainer.appendChild(this.stageMain);
    this.stageContainer.appendChild(this.stageSidebar);
    this.container.appendChild(this.stageContainer);
  }

  getWidgetLayoutType(widgetData, widgetInstance) {
    return (widgetData && widgetData.layoutType) || (widgetInstance && widgetInstance.layoutType) || 'grid';
  }

  getNextWidgetId() {
    this.widgetCounter = (this.widgetCounter || 0) + 1;
    return `widget-${this.widgetCounter}`;
  }

  emitWidgetUpdate(widgetInfo) {
    if (!widgetInfo || !this.onLayoutChange || this.isRestoring) return;
    const syncedHeight = this.isWidgetMinimized(widgetInfo) && Number.isFinite(widgetInfo.expandedHeight)
      ? widgetInfo.expandedHeight
      : widgetInfo.height;
    this.onLayoutChange({
      type: 'widget-update',
      id: widgetInfo.id,
      x: widgetInfo.x,
      y: widgetInfo.y,
      w: widgetInfo.width,
      h: syncedHeight,
      minimized: this.isWidgetMinimized(widgetInfo),
      stackOrder: this.widgets.map((candidate) => candidate.id)
    });
  }

  emitBusEvent(eventName, payload) {
    if (!layoutManagerEventBus) return;

    try {
      layoutManagerEventBus.emit(eventName, payload);
    } catch (error) {
      console.error(`[LayoutManager] Failed to emit ${eventName}`, error);
    }
  }

  runWidgetLayoutHook(widgetInfo, options = {}) {
    if (!widgetInfo || !widgetInfo.widget || typeof widgetInfo.widget.onWidgetLayout !== 'function') {
      return;
    }

    const widgetBounds = widgetInfo.element && typeof widgetInfo.element.getBoundingClientRect === 'function'
      ? widgetInfo.element.getBoundingClientRect()
      : { width: widgetInfo.width || 0, height: widgetInfo.height || 0 };

    try {
      widgetInfo.widget.onWidgetLayout({
        initial: !!options.initial,
        width: Math.max(0, Math.round(widgetBounds.width || 0)),
        height: Math.max(0, Math.round(widgetBounds.height || 0)),
        container: widgetInfo.element
      });
    } catch (error) {
      console.warn(`[LayoutManager] Widget layout hook failed for ${widgetInfo.widget.constructor?.name || 'unknown widget'}`, error);
    }
  }

  scheduleWidgetLayoutHook(widgetInfo, options = {}) {
    if (!widgetInfo || !widgetInfo.widget) {
      return;
    }

    if (widgetInfo.layoutFrame) {
      cancelAnimationFrame(widgetInfo.layoutFrame);
    }
    if (widgetInfo.layoutTimeout) {
      clearTimeout(widgetInfo.layoutTimeout);
    }

    widgetInfo.layoutFrame = requestAnimationFrame(() => {
      widgetInfo.layoutFrame = null;
      this.runWidgetLayoutHook(widgetInfo, options);
    });

    widgetInfo.layoutTimeout = setTimeout(() => {
      widgetInfo.layoutTimeout = null;
      this.runWidgetLayoutHook(widgetInfo, options);
    }, options.initial ? 120 : 0);
  }

  observeWidgetLayout(widgetInfo) {
    if (!widgetInfo || !widgetInfo.element || typeof ResizeObserver !== 'function') {
      this.scheduleWidgetLayoutHook(widgetInfo, { initial: true });
      return;
    }

    if (!widgetInfo.layoutObserver) {
      widgetInfo.layoutObserver = new ResizeObserver(() => {
        this.scheduleWidgetLayoutHook(widgetInfo);
      });
      widgetInfo.layoutObserver.observe(widgetInfo.element);
    }

    this.scheduleWidgetLayoutHook(widgetInfo, { initial: true });
  }

  teardownWidgetLayout(widgetInfo) {
    if (!widgetInfo) {
      return;
    }

    if (widgetInfo.layoutObserver) {
      widgetInfo.layoutObserver.disconnect();
      widgetInfo.layoutObserver = null;
    }
    if (widgetInfo.layoutFrame) {
      cancelAnimationFrame(widgetInfo.layoutFrame);
      widgetInfo.layoutFrame = null;
    }
    if (widgetInfo.layoutTimeout) {
      clearTimeout(widgetInfo.layoutTimeout);
      widgetInfo.layoutTimeout = null;
    }
  }

  discardAllWidgets() {
    this.widgets.forEach((widgetInfo) => {
      this.teardownWidgetLayout(widgetInfo);
      if (widgetInfo.widget && typeof widgetInfo.widget.onLayoutDiscard === 'function') {
        try {
          widgetInfo.widget.onLayoutDiscard();
        } catch (error) {
          console.warn('[LayoutManager] Widget discard hook failed.', error);
        }
      }
    });
    this.widgets = [];
  }

  mountWidgetElement(widgetInfo, options = {}) {
    const { element, layoutType } = widgetInfo;
    const appendTo = (target) => {
      if (!target) return;
      if (options.preserveStacking === true && element.parentElement === target) return;
      target.appendChild(element);
    };
    element.classList.toggle('is-minimized', this.isWidgetMinimized(widgetInfo));
    if (this.mode !== 'stage') {
      element.style.position = 'absolute';
      element.style.left = `${widgetInfo.x}px`;
      element.style.top = `${widgetInfo.y}px`;
      element.style.width = `${widgetInfo.width}px`;
      element.style.height = `${widgetInfo.height}px`;
      appendTo(this.container);
      return;
    }

    // In stage mode, default/grid widgets should remain freely placeable on the main stage.
    // Treat both `overlay` and legacy/default `grid` layout types as absolute widgets.
    if (layoutType === 'overlay' || layoutType === 'grid') {
      element.style.position = 'absolute';
      element.style.left = `${widgetInfo.x}px`;
      element.style.top = `${widgetInfo.y}px`;
      element.style.width = `${widgetInfo.width}px`;
      element.style.height = `${widgetInfo.height}px`;
      appendTo(this.stageMain);
      return;
    }

    if (layoutManagerIsTeacherMode() && layoutType === 'stage') {
      element.style.position = 'absolute';
      element.style.left = '0';
      element.style.top = '0';
      element.style.width = '100%';
      element.style.height = '100%';
      appendTo(this.stageMain);
      return;
    }

    element.style.position = 'relative';
    element.style.left = '';
    element.style.top = '';
    element.style.width = '100%';
    element.style.height = `${Math.max(widgetInfo.height, GRID_SIZE * 6)}px`;
    appendTo(this.stageSidebar);
  }

  applyWidgetStackOrder(widgetIds = []) {
    if (!Array.isArray(widgetIds) || widgetIds.length === 0) return false;

    const order = new Map(widgetIds.map((id, index) => [id, index]));
    this.widgets.sort((left, right) => {
      const leftIndex = order.has(left.id) ? order.get(left.id) : Number.MAX_SAFE_INTEGER;
      const rightIndex = order.has(right.id) ? order.get(right.id) : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
    // Keep mounted widget DOM in place. Re-appending an iframe-backed widget reloads
    // its document, which sends embedded presentations back to their first slide.
    this.widgets.forEach((widgetInfo, index) => {
      widgetInfo.element.style.setProperty('--widget-stack-order', String(index + 1));
    });
    return true;
  }

  bringWidgetToFront(widgetInfo) {
    if (!widgetInfo) return false;
    const stackOrder = this.widgets
      .filter((candidate) => candidate !== widgetInfo)
      .map((candidate) => candidate.id);
    stackOrder.push(widgetInfo.id);
    return this.applyWidgetStackOrder(stackOrder);
  }

  bindWidgetSelectionListeners() {
    if (this.widgetSelectionListenersBound) return;
    this.widgetSelectionListenersBound = true;

    const findManagedWidget = (target) => {
      const widgetElement = target instanceof Element ? target.closest('.widget') : null;
      if (!widgetElement) return null;
      return this.widgets.some((widgetInfo) => widgetInfo.element === widgetElement)
        ? widgetElement
        : null;
    };

    document.addEventListener('pointerdown', (event) => {
      if (!this.editable || !layoutManagerIsTeacherMode()) return;

      const widgetElement = findManagedWidget(event.target);
      if (widgetElement) {
        this.setSelectedWidgetElement(widgetElement);
        return;
      }

      if (event.target instanceof Element && event.target.closest('#widget-settings-modal')) return;
      this.setSelectedWidgetElement(null);
    }, true);

    document.addEventListener('focusin', (event) => {
      if (!this.editable || !layoutManagerIsTeacherMode()) return;
      const widgetElement = findManagedWidget(event.target);
      if (widgetElement) this.setSelectedWidgetElement(widgetElement);
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.editable || !this.selectedWidgetElement) return;
      if (document.querySelector('#widget-settings-modal.visible')) return;
      this.setSelectedWidgetElement(null);
    });
  }

  setSelectedWidgetElement(widgetElement) {
    const nextWidgetElement = widgetElement && this.widgets.some((widgetInfo) => widgetInfo.element === widgetElement)
      ? widgetElement
      : null;
    if (this.selectedWidgetElement === nextWidgetElement) return;

    const previousWidgetElement = this.selectedWidgetElement;
    if (previousWidgetElement) {
      const previousHeader = previousWidgetElement.querySelector(':scope > .widget-header');
      previousHeader?.querySelectorAll('.widget-header-menu[open]').forEach((menu) => {
        menu.open = false;
      });
      if (previousHeader?.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      previousWidgetElement.classList.remove('is-editing-selected');
    }

    this.selectedWidgetElement = nextWidgetElement;
    if (nextWidgetElement) {
      nextWidgetElement.classList.add('is-editing-selected');
    }

    this.widgets.forEach((widgetInfo) => this.updateWidgetChrome(widgetInfo));
  }

  getConstrainedSize(widget, widthPx, heightPx, canvasOverride = null) {
    // Convert rules to pixels roughly
    const type = widget.constructor.name;
    const rules = WIDGET_SIZE_RULES[type];
    if (!rules) return { width: widthPx, height: heightPx };

    // Approximation of column size
    const canvas = canvasOverride || this.getCanvasMetrics();
    const colSize = canvas.width / this.gridColumns || 80;
    const rowSize = canvas.height / this.gridRows || 80;

    let w = widthPx;
    let h = heightPx;

    if (rules.minW) w = Math.max(w, Math.min(rules.minW * colSize, canvas.width));
    if (rules.minH) h = Math.max(h, Math.min(rules.minH * rowSize, canvas.height));
    if (rules.minWidthPx) w = Math.max(w, Math.min(rules.minWidthPx, canvas.width));
    if (rules.minHeightPx) h = Math.max(h, Math.min(rules.minHeightPx, canvas.height));
    if (rules.maxW) w = Math.min(w, rules.maxW * colSize);
    if (rules.maxH) h = Math.min(h, rules.maxH * rowSize);
    if (type === 'RevealManagerWidget') {
      const revealMinHeight = Math.min((rules.minH || 5) * rowSize, canvas.height);
      const revealCardHeight = Math.min(canvas.height, Math.max(revealMinHeight, w * 0.72));
      h = Math.min(h, revealCardHeight);
    }

    return { width: w, height: h };
  }

  normalizeWidgetBounds(x, y, width, height, { avoidTeacherToolbar = true } = {}) {
    const canvas = this.getCanvasMetrics();
    const toolbarObstacle = avoidTeacherToolbar ? this.getTeacherToolbarObstacle() : null;
    const requestedWidth = Number.isFinite(width) && width > 0 ? width : 320;
    const requestedHeight = Number.isFinite(height) && height > 0 ? height : 240;
    const minimumHeight = requestedHeight <= MINIMIZED_WIDGET_HEIGHT
      ? MINIMIZED_WIDGET_HEIGHT
      : GRID_SIZE * 4;
    const safeWidth = clamp(requestedWidth, Math.min(GRID_SIZE * 4, canvas.width), canvas.width);
    const safeHeight = clamp(requestedHeight, Math.min(minimumHeight, canvas.height), canvas.height);
    const maxX = canvas.minX + Math.max(0, canvas.width - safeWidth);
    const maxY = canvas.minY + Math.max(0, canvas.height - safeHeight);

    const bounded = {
      x: clamp(Number.isFinite(x) ? x : canvas.minX, canvas.minX, maxX),
      y: clamp(Number.isFinite(y) ? y : canvas.minY, canvas.minY, maxY),
      width: safeWidth,
      height: safeHeight
    };

    return this.keepWidgetClearOfTeacherToolbar(bounded, canvas, toolbarObstacle);
  }

  normalizeWidgetDragBounds(x, y, width, height) {
    return this.normalizeWidgetBounds(x, y, width, height, { avoidTeacherToolbar: false });
  }

  updateWidgetChrome(widgetInfo) {
    const header = widgetInfo?.element?.querySelector(':scope > .widget-header');
    if (!header) return;

    const editingChromeAvailable = this.editable && (
      this.isWidgetMinimized(widgetInfo)
      || widgetInfo.element === this.selectedWidgetElement
    );
    header.setAttribute('aria-hidden', this.editable ? 'false' : 'true');
    header.toggleAttribute('inert', !this.editable);

    const bodyDragHandle = widgetInfo.element.querySelector('.widget-body-drag-handle');
    if (bodyDragHandle) {
      bodyDragHandle.tabIndex = editingChromeAvailable ? 0 : -1;
    }
  }

  handleWidgetMoveKeydown(event, widgetElement) {
    const step = event.shiftKey ? GRID_SIZE * 2 : GRID_SIZE;
    const movement = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }[event.key];
    if (!movement || !this.editable) return;

    event.preventDefault();
    const widgetInfo = this.widgets.find(info => info.element === widgetElement);
    if (!widgetInfo) return;
    this.bringWidgetToFront(widgetInfo);

    const bounded = this.normalizeWidgetDragBounds(
      widgetInfo.x + movement[0],
      widgetInfo.y + movement[1],
      widgetInfo.width,
      widgetInfo.height
    );
    widgetInfo.x = Math.round(bounded.x / GRID_SIZE) * GRID_SIZE;
    widgetInfo.y = Math.round(bounded.y / GRID_SIZE) * GRID_SIZE;
    widgetElement.style.left = `${widgetInfo.x}px`;
    widgetElement.style.top = `${widgetInfo.y}px`;
    if (this.editable && layoutManagerIsTeacherMode()) {
      this.setSelectedWidgetElement(widgetElement);
    }
    this.emitWidgetUpdate(widgetInfo);
    this.saveLayout({ emitFull: false });
  }

  clampWidgetToContainer(widgetInfo) {
    if (!widgetInfo) return;
    const bounded = this.normalizeWidgetDragBounds(widgetInfo.x, widgetInfo.y, widgetInfo.width, widgetInfo.height);
    widgetInfo.x = Math.round(bounded.x / GRID_SIZE) * GRID_SIZE;
    widgetInfo.y = Math.round(bounded.y / GRID_SIZE) * GRID_SIZE;
    widgetInfo.width = Math.round(bounded.width / GRID_SIZE) * GRID_SIZE;
    widgetInfo.height = Math.round(bounded.height / GRID_SIZE) * GRID_SIZE;
    if (!this.isWidgetMinimized(widgetInfo)) {
      widgetInfo.expandedHeight = widgetInfo.height;
    }
  }

  clampAllWidgetsToContainer() {
    this.widgets.forEach((widgetInfo) => {
      this.clampWidgetToContainer(widgetInfo);
    });
    this.widgets.forEach((widgetInfo) => {
      this.mountWidgetElement(widgetInfo);
    });
  }

  ensureTeacherWidgetSpacing() {
    // Overlap is intentional: teachers can layer widgets to make better use of
    // the canvas. The widget stack order decides which one appears on top.
    return false;
  }

  moveWidgetByDelta(widgetElement, dx, dy) {
    const info = this.widgets.find(w => w.element === widgetElement);
    if (!info) return;

    // dx, dy are assumed to be steps (e.g. arrow keys). Move by GRID_SIZE.
    const deltaX = dx * GRID_SIZE;
    const deltaY = dy * GRID_SIZE;

    let newX = info.x + deltaX;
    let newY = info.y + deltaY;

    // Constraints
    const bounded = this.normalizeWidgetDragBounds(newX, newY, info.width, info.height);
    newX = bounded.x;
    newY = bounded.y;

    // Snap
    newX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
    newY = Math.round(newY / GRID_SIZE) * GRID_SIZE;

    if (newX !== info.x || newY !== info.y) {
      info.x = newX;
      info.y = newY;

      info.element.style.left = `${newX}px`;
      info.element.style.top = `${newY}px`;

      this.emitWidgetUpdate(info);
      this.emitBusEvent('widget:moved', { id: info.id, x: info.x, y: info.y, width: info.width, height: info.height });
      this.saveLayout({ emitFull: false });
    }
  }

  rectsOverlap(a, b) {
    if (!a || !b) return false;

    const gap = layoutManagerIsTeacherMode() ? TEACHER_WIDGET_GAP : 0;

    return a.x < b.x + b.width + gap
      && a.x + a.width + gap > b.x
      && a.y < b.y + b.height + gap
      && a.y + a.height + gap > b.y;
  }

  resolveWidgetPlacementConflict(widgetInfo) {
    if (!widgetInfo || !widgetInfo.element) return false;
    if (this.mode === 'stage' && widgetInfo.layoutType === 'stage') return false;

    const parent = widgetInfo.element.parentElement;
    if (!parent) return false;

    const maxWidth = parent.clientWidth || this.container.clientWidth || 1024;
    const maxHeight = parent.clientHeight || this.container.clientHeight || 768;
    const currentWidth = widgetInfo.width;
    const currentHeight = widgetInfo.height;
    const siblings = this.widgets.filter((info) => info && info !== widgetInfo && info.element && info.element.parentElement === parent);

    const originalX = widgetInfo.x;
    const originalY = widgetInfo.y;
    const maxRadius = Math.max(1, Math.ceil(Math.max(maxWidth, maxHeight) / GRID_SIZE));
    const visited = new Set();
    const originalRect = {
      x: originalX,
      y: originalY,
      width: currentWidth,
      height: currentHeight
    };

    if (!siblings.some((other) => this.rectsOverlap(originalRect, other))) {
      return false;
    }

    const tryCandidate = (candidateX, candidateY) => {
      const bounded = this.normalizeWidgetBounds(candidateX, candidateY, currentWidth, currentHeight);
      const snappedX = Math.round(bounded.x / GRID_SIZE) * GRID_SIZE;
      const snappedY = Math.round(bounded.y / GRID_SIZE) * GRID_SIZE;
      const key = `${snappedX}:${snappedY}`;

      if (visited.has(key)) {
        return false;
      }
      visited.add(key);

      const candidateRect = {
        x: snappedX,
        y: snappedY,
        width: currentWidth,
        height: currentHeight
      };

      const overlap = siblings.some((other) => this.rectsOverlap(candidateRect, other));
      if (overlap) {
        return false;
      }

      if (snappedX === widgetInfo.x && snappedY === widgetInfo.y) {
        return false;
      }

      widgetInfo.x = snappedX;
      widgetInfo.y = snappedY;
      widgetInfo.element.style.left = `${snappedX}px`;
      widgetInfo.element.style.top = `${snappedY}px`;
      return true;
    };

    for (let radius = 0; radius <= maxRadius; radius += 1) {
      if (radius === 0) {
        if (tryCandidate(originalX, originalY)) {
          return true;
        }
        continue;
      }

      for (let offset = -radius; offset <= radius; offset += 1) {
        if (tryCandidate(originalX + (offset * GRID_SIZE), originalY - (radius * GRID_SIZE))) {
          return true;
        }
        if (tryCandidate(originalX + (offset * GRID_SIZE), originalY + (radius * GRID_SIZE))) {
          return true;
        }
      }

      for (let offset = -radius + 1; offset <= radius - 1; offset += 1) {
        if (tryCandidate(originalX - (radius * GRID_SIZE), originalY + (offset * GRID_SIZE))) {
          return true;
        }
        if (tryCandidate(originalX + (radius * GRID_SIZE), originalY + (offset * GRID_SIZE))) {
          return true;
        }
      }
    }

    return false;
  }

  addWidget(widget, x = null, y = null, width = null, height = null) {
    layoutManagerApplyAppModeToWidget(widget);
     const canvas = this.getCanvasMetrics();
     const containerW = canvas.width;
     const containerH = canvas.height;
     const colW = containerW / this.gridColumns;
     const rowH = containerH / this.gridRows;
     const rules = WIDGET_SIZE_RULES[widget.constructor.name] || {};
     const defaultW = rules.defaultW || 3;
     const defaultH = rules.defaultH || 2;
     const maxCols = Math.max(1, Math.floor((containerW + GRID_SIZE) / Math.max((colW * defaultW) + GRID_SIZE, GRID_SIZE)));

     // Default size uses widget-specific grid unit defaults when not provided.
     let finalW = width !== null ? width : colW * defaultW;
     let finalH = height !== null ? height : rowH * defaultH;

     // Heuristic: if width is small (<= 12), assume grid units and convert.
     if (finalW <= 12) finalW = finalW * colW;
     if (finalH <= 12) finalH = finalH * rowH;
     if (rules.minWidthPx) finalW = Math.max(finalW, Math.min(rules.minWidthPx, containerW));
     if (rules.minHeightPx) finalH = Math.max(finalH, Math.min(rules.minHeightPx, containerH));

     let finalX = x;
     let finalY = y;

     if (finalX === null || finalY === null) {
        // Stagger new widgets so they don't exactly overlap previous ones
        const count = this.widgets.length;
        const staggerOffset = Math.min((count % 10) * (GRID_SIZE * 2), 200);
        finalX = GRID_SIZE * 2 + staggerOffset;
        finalY = GRID_SIZE * 2 + staggerOffset;
     } else {
         // Heuristic: if x is small (<= 12), assume grid units
         if (finalX <= 12 && finalX < containerW / 20) finalX = finalX * colW;
         if (finalY <= 12 && finalY < containerH / 20) finalY = finalY * rowH;
     }

     // Snap to grid initially
     finalX = Math.round(finalX / GRID_SIZE) * GRID_SIZE;
     finalY = Math.round(finalY / GRID_SIZE) * GRID_SIZE;
     finalW = Math.round(finalW / GRID_SIZE) * GRID_SIZE;
     finalH = Math.round(finalH / GRID_SIZE) * GRID_SIZE;

     const bounded = this.normalizeWidgetBounds(finalX, finalY, finalW, finalH);
     finalX = Math.round(bounded.x / GRID_SIZE) * GRID_SIZE;
     finalY = Math.round(bounded.y / GRID_SIZE) * GRID_SIZE;
     finalW = Math.round(bounded.width / GRID_SIZE) * GRID_SIZE;
     finalH = Math.round(bounded.height / GRID_SIZE) * GRID_SIZE;

    // Create widget container
    const widgetElement = document.createElement('div');
    const widgetType = widget.constructor.name.replace(/Widget$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().substring(1);
    widgetElement.className = `widget ${widgetType}-widget`;

    // Clear grid styles
    widgetElement.style.gridColumn = '';
    widgetElement.style.gridRow = '';

    this.createWidgetHeader(widget, widgetElement, widgetType);

    const content = document.createElement('div');
    content.className = 'widget-content';
    content.appendChild(widget.element);
    widgetElement.appendChild(content);

    this.addResizeHandles(widgetElement);
    this.addDragFunctionality(widgetElement);
    
    const widgetInfo = {
      id: this.getNextWidgetId(),
      element: widgetElement,
      widget: widget,
      layoutType: this.getWidgetLayoutType(null, widget),
      x: finalX,
      y: finalY,
      width: finalW,
      height: finalH,
      expandedHeight: finalH,
      minimized: false,
      visibleOnProjector: true,
      projectorVisibilityConfigured: false
    };

    widget.widgetId = widgetInfo.id;
    widget.widgetInfo = widgetInfo;
    this.widgets.push(widgetInfo);
    this.updateWidgetChrome(widgetInfo);
    this.refreshWidgetMinimizeControl(widgetInfo);
    this.refreshWidgetProjectorVisibilityControl(widgetInfo);
    this.mode = layoutManagerIsTeacherMode() && this.widgets.some((info) => info.layoutType === 'stage') ? 'stage' : 'dashboard';
    this.setupModeStructure();
    this.widgets.forEach((info) => {
      this.mountWidgetElement(info);
      this.observeWidgetLayout(info);
    });

    this.resolveWidgetPlacementConflict(widgetInfo);

    if (this.editable && layoutManagerIsTeacherMode()) {
      this.setSelectedWidgetElement(widgetElement);
    }

    if (typeof widget.setEditable === 'function') {
      widget.setEditable(this.editable);
    }

    this.emitBusEvent('widget:created', { id: widgetInfo.id, type: widget.constructor.name });
    this.saveLayout();
    return widgetElement;
  }

  getWidgetProjectorVisibilityLabel(widgetInfo) {
    return widgetInfo && widgetInfo.visibleOnProjector !== false
      ? 'Visible to students'
      : 'Teacher only';
  }

  isWidgetMinimized(widgetInfo) {
    return layoutManagerIsTeacherMode() && widgetInfo?.minimized === true;
  }

  refreshWidgetMinimizeControl(widgetInfo) {
    if (!widgetInfo) return;

    const minimizeButton = widgetInfo.minimizeButton || widgetInfo.widget?.minimizeButton;
    const isMinimized = this.isWidgetMinimized(widgetInfo);
    widgetInfo.element?.classList.toggle('is-minimized', isMinimized);
    if (!minimizeButton) return;

    widgetInfo.minimizeButton = minimizeButton;
    minimizeButton.innerHTML = isMinimized
      ? '<i class="fas fa-window-restore" aria-hidden="true"></i><span>Restore widget</span>'
      : '<i class="fas fa-window-minimize" aria-hidden="true"></i><span>Minimise widget</span>';
    minimizeButton.setAttribute('aria-label', isMinimized ? 'Restore widget' : 'Minimise widget');
    minimizeButton.classList.toggle('is-expanded', !isMinimized);
    minimizeButton.classList.toggle('is-minimized', isMinimized);
  }

  setWidgetMinimized(widgetInfo, minimized) {
    if (!widgetInfo) return;

    const nextMinimized = minimized === true;
    if (nextMinimized === this.isWidgetMinimized(widgetInfo)) return;

    if (nextMinimized && widgetInfo.element === this.selectedWidgetElement) {
      this.setSelectedWidgetElement(null);
    }

    if (nextMinimized) {
      if (Number.isFinite(widgetInfo.height) && widgetInfo.height > MINIMIZED_WIDGET_HEIGHT) {
        widgetInfo.expandedHeight = widgetInfo.height;
      }
      widgetInfo.height = MINIMIZED_WIDGET_HEIGHT;
    } else {
      const restoreHeight = Number.isFinite(widgetInfo.expandedHeight)
        ? widgetInfo.expandedHeight
        : GRID_SIZE * 4;
      const bounded = this.normalizeWidgetDragBounds(widgetInfo.x, widgetInfo.y, widgetInfo.width, restoreHeight);
      widgetInfo.x = Math.round(bounded.x / GRID_SIZE) * GRID_SIZE;
      widgetInfo.y = Math.round(bounded.y / GRID_SIZE) * GRID_SIZE;
      widgetInfo.width = Math.round(bounded.width / GRID_SIZE) * GRID_SIZE;
      widgetInfo.height = Math.round(bounded.height / GRID_SIZE) * GRID_SIZE;
      widgetInfo.expandedHeight = widgetInfo.height;
    }

    widgetInfo.minimized = nextMinimized;
    this.refreshWidgetMinimizeControl(widgetInfo);
    this.updateWidgetChrome(widgetInfo);
    this.mountWidgetElement(widgetInfo);
    if (!nextMinimized) this.scheduleWidgetLayoutHook(widgetInfo);
    this.saveLayout();
  }

  refreshWidgetProjectorVisibilityControl(widgetInfo) {
    if (!widgetInfo) return;

    const projectorVisibilityButton = widgetInfo.projectorVisibilityButton || widgetInfo.widget?.projectorVisibilityButton;
    if (!projectorVisibilityButton) return;

    widgetInfo.projectorVisibilityButton = projectorVisibilityButton;
    const isVisible = widgetInfo.visibleOnProjector !== false;
    projectorVisibilityButton.innerHTML = isVisible
      ? '<i class="fas fa-eye-slash" aria-hidden="true"></i><span>Hide from students</span>'
      : '<i class="fas fa-eye" aria-hidden="true"></i><span>Show to students</span>';
    projectorVisibilityButton.setAttribute('aria-label', isVisible
      ? 'Hide widget from students'
      : 'Show widget to students');
    projectorVisibilityButton.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
    projectorVisibilityButton.classList.toggle('is-visible', isVisible);
    projectorVisibilityButton.classList.toggle('is-teacher-only', !isVisible);
  }

  setWidgetProjectorVisibility(widgetInfo, visibleOnProjector) {
    if (!widgetInfo) return;

    widgetInfo.visibleOnProjector = visibleOnProjector !== false;
    widgetInfo.projectorVisibilityConfigured = true;
    this.refreshWidgetProjectorVisibilityControl(widgetInfo);
    this.saveLayout();
  }

  createWidgetHeader(widget, widgetElement, widgetType) {
    const header = document.createElement('div');
    header.className = 'widget-header';

    // Permanent compact drag handle.
    const title = document.createElement('div');
    title.className = 'widget-header-title';

    // Format the title from the class name (e.g. Timer, Rich Text, etc.)
    const nameStr = widget.constructor.name.replace(/Widget$/, '');
    const readableName = WIDGET_DISPLAY_NAMES[widget.constructor.name]
      || nameStr.replace(/([A-Z])/g, ' $1').trim();

    title.innerHTML = `<span>${readableName}</span>`;
    title.tabIndex = 0;
    title.setAttribute('role', 'button');
    title.setAttribute('aria-label', `Move ${readableName}`);
    title.title = `Drag to move ${readableName}`;
    title.addEventListener('mousedown', () => title.focus({ preventScroll: true }));
    title.addEventListener('keydown', (event) => this.handleWidgetMoveKeydown(event, widgetElement));
    header.appendChild(title);

    const menu = document.createElement('details');
    menu.className = 'widget-header-menu';
    const menuToggle = document.createElement('summary');
    menuToggle.className = 'widget-header-menu__toggle';
    menuToggle.setAttribute('aria-label', `${readableName} options`);
    menuToggle.title = `${readableName} options`;
    menuToggle.innerHTML = '<i class="fas fa-ellipsis-h" aria-hidden="true"></i>';
    menu.appendChild(menuToggle);

    const menuItems = document.createElement('div');
    menuItems.className = 'widget-header-menu__popover';

    const closeMenu = () => {
      menu.open = false;
    };

    menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      document.querySelectorAll('.widget-header-menu[open]').forEach((otherMenu) => {
        if (otherMenu !== menu) otherMenu.open = false;
      });
      const toggleRect = menuToggle.getBoundingClientRect();
      const popoverWidth = menuItems.getBoundingClientRect().width || 178;
      menu.classList.toggle('widget-header-menu--align-end', toggleRect.left + popoverWidth > window.innerWidth - 8);
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu();
      menuToggle.focus();
    });

    // Student/projector visibility without hiding the widget from the teacher.
    if (layoutManagerIsTeacherMode()) {
      const minimizeButton = document.createElement('button');
      minimizeButton.className = 'widget-minimize-btn widget-header-menu__item';
      minimizeButton.type = 'button';
      minimizeButton.innerHTML = '<i class="fas fa-window-minimize" aria-hidden="true"></i><span>Minimise widget</span>';
      minimizeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const widgetInfo = this.widgets.find(info => info.widget === widget);
        if (!widgetInfo) return;
        this.setWidgetMinimized(widgetInfo, !this.isWidgetMinimized(widgetInfo));
        closeMenu();
      });
      widget.minimizeButton = minimizeButton;
      menuItems.appendChild(minimizeButton);

      const projectorVisibilityButton = document.createElement('button');
      projectorVisibilityButton.className = 'widget-projector-visibility-btn widget-header-menu__item';
      projectorVisibilityButton.type = 'button';
      projectorVisibilityButton.setAttribute('role', 'menuitem');
      projectorVisibilityButton.setAttribute('aria-pressed', 'false');
      projectorVisibilityButton.innerHTML = '<i class="fas fa-eye-slash" aria-hidden="true"></i><span>Hide from students</span>';

      projectorVisibilityButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const widgetInfo = this.widgets.find(info => info.widget === widget);
        if (!widgetInfo) return;
        this.setWidgetProjectorVisibility(widgetInfo, widgetInfo.visibleOnProjector === false);
        closeMenu();
      });

      widget.projectorVisibilityButton = projectorVisibilityButton;
      menuItems.appendChild(projectorVisibilityButton);
    }

    const widgetMenuActions = typeof widget.getHeaderMenuActions === 'function'
      ? widget.getHeaderMenuActions()
      : [];

    widgetMenuActions.forEach((action) => {
      if (!action?.label || typeof action.onSelect !== 'function') return;

      const actionButton = document.createElement('button');
      actionButton.className = ['widget-header-menu__item', action.className]
        .filter(Boolean)
        .join(' ');
      actionButton.type = 'button';
      actionButton.setAttribute('aria-label', action.ariaLabel || action.label);
      actionButton.title = action.title || action.label;

      if (action.iconClass) {
        const icon = document.createElement('i');
        icon.className = action.iconClass;
        icon.setAttribute('aria-hidden', 'true');
        actionButton.appendChild(icon);
      }

      const label = document.createElement('span');
      label.textContent = action.label;
      actionButton.appendChild(label);

      actionButton.addEventListener('click', (event) => {
        event.stopPropagation();
        closeMenu();
        action.onSelect();
      });

      menuItems.appendChild(actionButton);
    });

    // Settings menu item. Widgets with complete inline controls can hide this duplicate entry.
    if (widget?.showSettingsMenu !== false) {
      const settingsBtn = document.createElement('button');
      settingsBtn.className = 'widget-header-settings-btn widget-header-menu__item';
      settingsBtn.type = 'button';
      settingsBtn.innerHTML = '<i class="fas fa-cog" aria-hidden="true"></i><span>Widget settings</span>';
      settingsBtn.setAttribute('aria-label', 'Open Settings');
      settingsBtn.title = 'Widget Settings';
      settingsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeMenu();
          const event = new CustomEvent('openWidgetSettings', { detail: { widget } });
          document.dispatchEvent(event);
      });
      menuItems.appendChild(settingsBtn);
    }

    // Remove menu item.
    const removeBtn = document.createElement('button');
    removeBtn.className = 'widget-remove-btn widget-header-menu__item widget-header-menu__item--danger';
    removeBtn.type = 'button';
    removeBtn.innerHTML = '<i class="fas fa-trash" aria-hidden="true"></i><span>Remove widget</span>';
    removeBtn.setAttribute('aria-label', 'Remove Widget');
    removeBtn.title = 'Remove Widget';
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        this.removeWidget(widget);
    });
    menuItems.appendChild(removeBtn);

    menu.appendChild(menuItems);
    header.appendChild(menu);
    widgetElement.appendChild(header);
  }


  removeWidget(widget) {
    const widgetInfo = this.widgets.find(info => info.widget === widget);
    if (widgetInfo) {
      if (widgetInfo.element === this.selectedWidgetElement) {
        this.setSelectedWidgetElement(null);
      }
      this.teardownWidgetLayout(widgetInfo);
      let widgetRemovedEventDispatched = false;

      const trackWidgetRemoved = (event) => {
        if (event && event.detail && event.detail.widget === widget) {
          widgetRemovedEventDispatched = true;
        }
      };

      document.addEventListener('widgetRemoved', trackWidgetRemoved);

      if (widget && typeof widget.remove === 'function') {
        widget.remove();
      } else if (widget && typeof widget.destroy === 'function') {
        widget.destroy();
      }

      document.removeEventListener('widgetRemoved', trackWidgetRemoved);

      if (widgetInfo.element && widgetInfo.element.isConnected) {
        widgetInfo.element.remove();
      }

      this.widgets = this.widgets.filter(info => info.widget !== widget);
      this.saveLayout();

      if (!widgetRemovedEventDispatched) {
        const event = new CustomEvent('widgetRemoved', { detail: { widget } });
        document.dispatchEvent(event);
      }

      this.emitBusEvent('widget:removed', { id: widgetInfo.id, type: widgetInfo.widget?.constructor?.name || null, widget: widgetInfo.widget });
    }
  }
  
  addResizeHandles(element) {
    const handlePositions = [
      'top',
      'bottom',
      'left',
      'right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right'
    ];

    handlePositions.forEach((position) => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${position}`;
      element.appendChild(handle);
    });

    const onMouseDown = (e) => {
      if (!this.editable) return;

      const target = e.target;
      if (!target.classList.contains('resize-handle')) return;

      const classNames = Array.from(target.classList);
      const isLeft = classNames.some(name => name.includes('left'));
      const isRight = classNames.some(name => name.includes('right'));
      const isTop = classNames.some(name => name.includes('top'));
      const isBottom = classNames.some(name => name.includes('bottom'));

      const startX = e.clientX;
      const startY = e.clientY;

      const startWidth = parseInt(element.style.width, 10) || element.offsetWidth;
      const startHeight = parseInt(element.style.height, 10) || element.offsetHeight;
      const startLeft = parseInt(element.style.left, 10) || 0;
      const startTop = parseInt(element.style.top, 10) || 0;

      const info = this.widgets.find(w => w.element === element);
      this.bringWidgetToFront(info);
      const rules = info ? WIDGET_SIZE_RULES[info.widget.constructor.name] || {} : {};
      const canvas = this.getCanvasMetrics();
      const colW = canvas.width / this.gridColumns || COL_PX_ESTIMATE;
      const rowH = canvas.height / this.gridRows || COL_PX_ESTIMATE;
      const minWidth = Math.round(Math.max(rules.minW ? rules.minW * colW : GRID_SIZE * 4, rules.minWidthPx || 0) / GRID_SIZE) * GRID_SIZE;
      const minHeight = Math.round(Math.max(rules.minH ? rules.minH * rowH : GRID_SIZE * 3, rules.minHeightPx || 0) / GRID_SIZE) * GRID_SIZE;
      let resizeFrame = null;
      let pendingResize = null;

      const applyResizePosition = () => {
        resizeFrame = null;
        if (!pendingResize) return;

        element.style.width = `${pendingResize.width}px`;
        element.style.height = `${pendingResize.height}px`;
        element.style.left = `${pendingResize.left}px`;
        element.style.top = `${pendingResize.top}px`;
      };

      const onMouseMove = (moveEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;

        if (isRight) {
          newWidth = startWidth + deltaX;
        }

        if (isLeft) {
          newWidth = startWidth - deltaX;
          newLeft = startLeft + deltaX;
        }

        if (isBottom) {
          newHeight = startHeight + deltaY;
        }

        if (isTop) {
          newHeight = startHeight - deltaY;
          newTop = startTop + deltaY;
        }

        if (newWidth < minWidth) {
          if (isLeft) {
            newLeft -= (minWidth - newWidth);
          }
          newWidth = minWidth;
        }

        if (newHeight < minHeight) {
          if (isTop) {
            newTop -= (minHeight - newHeight);
          }
          newHeight = minHeight;
        }

        const bounded = this.normalizeWidgetBounds(newLeft, newTop, newWidth, newHeight);
        newWidth = bounded.width;
        newHeight = bounded.height;
        newLeft = bounded.x;
        newTop = bounded.y;

        pendingResize = {
          width: Math.round(newWidth),
          height: Math.round(newHeight),
          left: Math.round(newLeft),
          top: Math.round(newTop)
        };

        if (!resizeFrame) {
          resizeFrame = requestAnimationFrame(applyResizePosition);
        }
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        element.classList.remove('is-resizing');
        document.body.classList.remove('widget-resize-active');

        if (resizeFrame) {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = null;
        }

        if (pendingResize) {
          element.style.width = `${pendingResize.width}px`;
          element.style.height = `${pendingResize.height}px`;
          element.style.left = `${pendingResize.left}px`;
          element.style.top = `${pendingResize.top}px`;
        }

        let finalWidth = parseInt(element.style.width, 10) || startWidth;
        let finalHeight = parseInt(element.style.height, 10) || startHeight;
        let finalLeft = parseInt(element.style.left, 10) || startLeft;
        let finalTop = parseInt(element.style.top, 10) || startTop;

        finalWidth = Math.round(finalWidth / GRID_SIZE) * GRID_SIZE;
        finalHeight = Math.round(finalHeight / GRID_SIZE) * GRID_SIZE;
        finalLeft = Math.round(finalLeft / GRID_SIZE) * GRID_SIZE;
        finalTop = Math.round(finalTop / GRID_SIZE) * GRID_SIZE;

        const bounded = this.normalizeWidgetBounds(finalLeft, finalTop, finalWidth, finalHeight);
        finalWidth = Math.round(bounded.width / GRID_SIZE) * GRID_SIZE;
        finalHeight = Math.round(bounded.height / GRID_SIZE) * GRID_SIZE;
        finalLeft = Math.round(bounded.x / GRID_SIZE) * GRID_SIZE;
        finalTop = Math.round(bounded.y / GRID_SIZE) * GRID_SIZE;

        element.style.width = `${finalWidth}px`;
        element.style.height = `${finalHeight}px`;
        element.style.left = `${finalLeft}px`;
        element.style.top = `${finalTop}px`;

        if (info) {
          info.width = finalWidth;
          info.height = finalHeight;
          info.expandedHeight = finalHeight;
          info.x = finalLeft;
          info.y = finalTop;
        }

        pendingResize = null;
        this.emitWidgetUpdate(info);
        if (info) {
          this.emitBusEvent('widget:moved', { id: info.id, x: info.x, y: info.y, width: info.width, height: info.height });
        }
        this.saveLayout({ emitFull: false });
      };

      e.preventDefault();
      e.stopPropagation();
      element.classList.add('is-resizing');
      document.body.classList.add('widget-resize-active');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    element.addEventListener('mousedown', onMouseDown);
  }

  addDragFunctionality(widgetElement) {
    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop;
    let dragFrame = null;
    let pendingPosition = null;

    const applyDragPosition = () => {
      dragFrame = null;
      if (!pendingPosition) return;

      widgetElement.style.left = `${pendingPosition.x}px`;
      widgetElement.style.top = `${pendingPosition.y}px`;
    };

    const bodyDragHandle = widgetElement.querySelector('.pomodoro-display');
    if (bodyDragHandle) {
      bodyDragHandle.classList.add('widget-body-drag-handle');
      bodyDragHandle.setAttribute('role', 'group');
      bodyDragHandle.setAttribute('aria-label', 'Timer. Drag to move, or use the arrow keys.');
      bodyDragHandle.title = 'Drag anywhere on the clock to move';
      bodyDragHandle.tabIndex = this.editable ? 0 : -1;
      bodyDragHandle.addEventListener('keydown', (event) => this.handleWidgetMoveKeydown(event, widgetElement));
    }

    widgetElement.addEventListener('mousedown', (e) => {
      if (!this.editable || e.button !== 0) return;

      const interactiveTarget = e.target.closest('button, summary, a, input, select, textarea, [contenteditable="true"]');
      if (interactiveTarget && widgetElement.contains(interactiveTarget)) return;

      const timerBodyHandle = widgetElement.classList.contains('pomodoro-widget')
        ? e.target.closest('.widget-body-drag-handle')
        : null;
      const dragHandle = timerBodyHandle || e.target.closest('.widget-header-title');
      if (!dragHandle || !widgetElement.contains(dragHandle)) return;

      const widgetInfo = this.widgets.find((info) => info.element === widgetElement);
      this.bringWidgetToFront(widgetInfo);

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      initialLeft = parseInt(widgetElement.style.left, 10) || 0;
      initialTop = parseInt(widgetElement.style.top, 10) || 0;
      pendingPosition = { x: initialLeft, y: initialTop };
      widgetElement.classList.add('is-dragging');
      document.body.classList.add('widget-drag-active');

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const info = this.widgets.find(w => w.element === widgetElement);
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let left = initialLeft + deltaX;
      let top = initialTop + deltaY;
      const bounded = this.normalizeWidgetDragBounds(left, top, info?.width, info?.height);

      pendingPosition = {
        x: Math.round(bounded.x),
        y: Math.round(bounded.y)
      };

      if (!dragFrame) {
        dragFrame = requestAnimationFrame(applyDragPosition);
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (isDragging) {
        isDragging = false;
        widgetElement.classList.remove('is-dragging');
        document.body.classList.remove('widget-drag-active');

        if (dragFrame) {
          cancelAnimationFrame(dragFrame);
          dragFrame = null;
        }

        if (pendingPosition) {
          widgetElement.style.left = `${pendingPosition.x}px`;
          widgetElement.style.top = `${pendingPosition.y}px`;
        }

        const finalLeft = parseInt(widgetElement.style.left, 10) || 0;
        const finalTop = parseInt(widgetElement.style.top, 10) || 0;

        const info = this.widgets.find(w => w.element === widgetElement);
        const bounded = this.normalizeWidgetDragBounds(finalLeft, finalTop, info?.width, info?.height);
        const snappedLeft = Math.round(bounded.x / GRID_SIZE) * GRID_SIZE;
        const snappedTop = Math.round(bounded.y / GRID_SIZE) * GRID_SIZE;

        widgetElement.style.left = `${snappedLeft}px`;
        widgetElement.style.top = `${snappedTop}px`;

        if (info) {
          info.x = snappedLeft;
          info.y = snappedTop;
        }

        pendingPosition = null;

        this.emitWidgetUpdate(info);
        if (info) {
          this.emitBusEvent('widget:moved', { id: info.id, x: info.x, y: info.y, width: info.width, height: info.height });
        }
        this.saveLayout({ emitFull: false });
      }
    });
  }
  
  saveLayout(options = {}) {
    if (this.isRestoring) return;

    const layout = this.serialize();
    const json = JSON.stringify(layout);

    if (json === this.lastSavedLayoutJSON) {
      return;
    }

    this.lastSavedLayoutJSON = json;

    if (this.onLayoutChange && options.emitFull !== false) {
      this.onLayoutChange(layout);
    }

    this.emitBusEvent('layout:updated', { layout, options });
  }

  serialize(options = {}) {
    const widgets = this.widgets.map(widgetInfo => {
      const widget = widgetInfo.widget;
      const widgetData = options.forProjector === true && typeof widget.serializeForProjector === 'function'
        ? widget.serializeForProjector()
        : widget.serialize();
      const savedHeight = this.isWidgetMinimized(widgetInfo) && Number.isFinite(widgetInfo.expandedHeight)
        ? widgetInfo.expandedHeight
        : widgetInfo.height;
      // Return pixels
      return {
        id: widgetInfo.id,
        type: widgetInfo.widget.constructor.name,
        layoutType: widgetInfo.layoutType || 'grid',
        x: widgetInfo.x,
        y: widgetInfo.y,
        width: widgetInfo.width,
        height: savedHeight,
        minimized: options.forProjector === true ? false : widgetInfo.minimized === true,
        visibleOnProjector: widgetInfo.projectorVisibilityConfigured === true
          ? widgetInfo.visibleOnProjector !== false
          : true,
        projectorVisibilityConfigured: widgetInfo.projectorVisibilityConfigured === true,
        data: widgetData
      };
    });

    return {
      mode: this.mode,
      widgets,
      viewport: {
        width: this.container.clientWidth || null,
        height: this.container.clientHeight || null
      }
    };
  }
  
  loadLayout() {
    // This function seems unused as `main.js` calls deserialize directly from `loadSavedState`
    // but we can keep it for consistency.
    const layout = safeParseLocalStorage('widgetLayout');
    if (layout) {
      this.isRestoring = true;
      try {
        const layoutData = Array.isArray(layout) ? { mode: 'dashboard', widgets: layout } : layout;
        if (!isValidLayout(layoutData)) {
          console.warn('Invalid layout detected. Resetting layout state.');
          localStorage.removeItem('widgetLayout');
          return;
        }
        this.deserialize(layoutData, (widgetData) => this.createWidgetFromType(widgetData.type));
      } catch (e) {
        console.error('Failed to load layout:', e);
      } finally {
        this.isRestoring = false;
      }
    }
  }

  deserialize(layoutData, widgetFactory) {
    if (!layoutData || !Array.isArray(layoutData.widgets)) {
      return;
    }

    this.mode = layoutData.mode || (layoutManagerIsTeacherMode() && layoutData.widgets.some((widgetData) => this.getWidgetLayoutType(widgetData) === 'stage') ? 'stage' : 'dashboard');
    this.discardAllWidgets();
    this.setupModeStructure();

    const storedViewportW = layoutData.viewport && Number(layoutData.viewport.width) > 0
      ? Number(layoutData.viewport.width)
      : null;
    const storedViewportH = layoutData.viewport && Number(layoutData.viewport.height) > 0
      ? Number(layoutData.viewport.height)
      : null;
    // Saved classrooms are restored while their view is hidden, when the canvas can
    // temporarily report 0 x 0. Reuse the saved viewport in that state so positions
    // are not scaled against the legacy 1024 x 768 fallback before the view opens.
    const containerW = this.container.clientWidth || storedViewportW || 1024;
    const containerH = this.container.clientHeight || storedViewportH || 768;
    const sourceViewportW = storedViewportW || containerW;
    const sourceViewportH = storedViewportH || containerH;
    const widthScale = containerW / sourceViewportW;
    const heightScale = containerH / sourceViewportH;
    const colW = containerW / this.gridColumns;
    const rowH = containerH / this.gridRows;

    const parseGridPosition = (gridValue) => {
      const [startPart, endPart] = (gridValue || '').split('/').map(part => part.trim());
      const start = parseInt(startPart, 10) || 1;
      let span = 1;
      if (endPart) {
        const spanMatch = endPart.match(/span\s+(\d+)/);
        if (spanMatch) span = parseInt(spanMatch[1], 10) || 1;
      }
      return { start, span };
    };

    layoutData.widgets.forEach((widgetData) => {
      const widget = widgetFactory ? widgetFactory(widgetData) : this.createWidgetFromType(widgetData.type);
      if (!widget || !widget.element) return;
      layoutManagerApplyAppModeToWidget(widget);

      // Determine dimensions (pixels)
      let finalX = widgetData.x;
      let finalY = widgetData.y;
      let finalW = widgetData.width;
      let finalH = widgetData.height;

      // Backward compatibility: if data comes from old version, it might rely on gridColumn/gridRow
      // OR x/y/width/height might be small integers (grid units).

      if (widgetData.gridColumn || widgetData.gridRow) {
         // Legacy path
         const colInfo = parseGridPosition(widgetData.gridColumn);
         const rowInfo = parseGridPosition(widgetData.gridRow);
         finalX = (colInfo.start - 1) * colW;
         finalY = (rowInfo.start - 1) * rowH;
         finalW = colInfo.span * colW;
         finalH = rowInfo.span * rowH;
      } else {
         // Check if units are likely grid units
         if (finalX <= 12 && finalX < containerW/20) finalX = finalX * colW;
         if (finalY <= 12 && finalY < containerH/20) finalY = finalY * rowH;
         if (finalW <= 12) finalW = finalW * colW;
         if (finalH <= 12) finalH = finalH * rowH;
      }

      // Keep widget placement and size proportional when restoring into a different viewport
      // (e.g. projector screen resolution differs from teacher view).
      finalX *= widthScale;
      finalY *= heightScale;
      finalW *= widthScale;
      finalH *= heightScale;

      const rules = WIDGET_SIZE_RULES[widget.constructor.name] || {};
      if (widget.constructor.name === 'PomodoroWidget') {
        const preferredW = rules.defaultW ? rules.defaultW * colW : finalW;
        const preferredH = rules.defaultH ? rules.defaultH * rowH : finalH;
        const legacyDefaultW = 4 * colW;
        const legacyDefaultH = 3 * rowH;
        const previousCompactDefaultW = 2.5 * colW;
        const previousCompactDefaultH = 1.25 * rowH;
        const matchesLegacyDefault = Number.isFinite(finalW) && Number.isFinite(finalH)
          && Math.abs(finalW - legacyDefaultW) <= GRID_SIZE
          && Math.abs(finalH - legacyDefaultH) <= GRID_SIZE;
        const matchesPreviousCompactDefault = Number.isFinite(finalW) && Number.isFinite(finalH)
          && Math.abs(finalW - previousCompactDefaultW) <= GRID_SIZE
          && Math.abs(finalH - previousCompactDefaultH) <= GRID_SIZE;
        if (matchesLegacyDefault || matchesPreviousCompactDefault) {
          finalW = preferredW;
          finalH = preferredH;
        } else {
          finalW = !Number.isFinite(finalW) || finalW <= 0 ? preferredW : finalW;
          finalH = !Number.isFinite(finalH) || finalH <= 0 ? preferredH : finalH;
        }
      }

      if (widget.constructor.name === 'NoiseMeterWidget') {
        const preferredW = rules.defaultW ? rules.defaultW * colW : finalW;
        const preferredH = rules.defaultH ? rules.defaultH * rowH : finalH;
        const knownPreviousDefaults = [
          { width: 5 * colW, height: 5 * rowH },
          { width: 4.5 * colW, height: 4.25 * rowH },
          { width: 4.5 * colW, height: 3.5 * rowH },
          { width: 3.5 * colW, height: 2.25 * rowH }
        ];
        const matchesPreviousDefault = knownPreviousDefaults.some((size) => (
          Number.isFinite(finalW)
          && Number.isFinite(finalH)
          && Math.abs(finalW - size.width) <= GRID_SIZE
          && Math.abs(finalH - size.height) <= GRID_SIZE
        ));
        if (matchesPreviousDefault) {
          finalW = preferredW;
          finalH = preferredH;
        }
      }

      // Default fallback
      if (finalW == null) finalW = 320;
      if (finalH == null) finalH = 240;
      if (finalX == null) finalX = 0;
      if (finalY == null) finalY = 0;

      const constrained = this.getConstrainedSize(widget, finalW, finalH, { width: containerW, height: containerH });
      finalW = constrained.width;
      finalH = constrained.height;

      // Snap
      finalX = Math.round(finalX / GRID_SIZE) * GRID_SIZE;
      finalY = Math.round(finalY / GRID_SIZE) * GRID_SIZE;
      finalW = Math.round(finalW / GRID_SIZE) * GRID_SIZE;
      finalH = Math.round(finalH / GRID_SIZE) * GRID_SIZE;

      const bounded = this.normalizeWidgetDragBounds(finalX, finalY, finalW, finalH);
      finalX = Math.round(bounded.x / GRID_SIZE) * GRID_SIZE;
      finalY = Math.round(bounded.y / GRID_SIZE) * GRID_SIZE;
      finalW = Math.round(bounded.width / GRID_SIZE) * GRID_SIZE;
      finalH = Math.round(bounded.height / GRID_SIZE) * GRID_SIZE;

      const widgetElement = document.createElement('div');
      const widgetType = widget.constructor.name.replace(/Widget$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().substring(1);
      widgetElement.className = `widget ${widgetType}-widget`;

      this.createWidgetHeader(widget, widgetElement, widgetType);

      const content = document.createElement('div');
      content.className = 'widget-content';
      content.appendChild(widget.element);

      widgetElement.appendChild(content);

      this.addResizeHandles(widgetElement);
      this.addDragFunctionality(widgetElement);

      if (widgetData.data && typeof widget.deserialize === 'function') {
        widget.deserialize(widgetData.data);
      }

      const resolvedWidgetId = widgetData.id || this.getNextWidgetId();
      widget.widgetId = resolvedWidgetId;
      const visibleOnProjector = widgetData.projectorVisibilityConfigured === true
        ? widgetData.visibleOnProjector !== false
        : true;
      const minimized = layoutManagerIsTeacherMode() && widgetData.minimized === true;

      const widgetInfo = {
        id: resolvedWidgetId,
        element: widgetElement,
        widget: widget,
        layoutType: this.getWidgetLayoutType(widgetData, widget),
        x: finalX,
        y: finalY,
        width: finalW,
        height: minimized ? MINIMIZED_WIDGET_HEIGHT : finalH,
        expandedHeight: finalH,
        minimized,
        projectorVisibilityConfigured: widgetData.projectorVisibilityConfigured === true,
        visibleOnProjector
      };
      widget.widgetInfo = widgetInfo;
      this.widgets.push(widgetInfo);
      this.updateWidgetChrome(widgetInfo);
      this.refreshWidgetMinimizeControl(widgetInfo);
      this.refreshWidgetProjectorVisibilityControl(widgetInfo);

      if (typeof widget.setEditable === 'function') {
        widget.setEditable(this.editable);
      }
    });

    this.widgets.forEach((widgetInfo) => {
      this.mountWidgetElement(widgetInfo);
      this.observeWidgetLayout(widgetInfo);
    });
  }

  applyLayoutDelta(delta) {
    if (!delta || delta.type !== 'widget-update') return;
    const widget = this.widgets.find((w) => w.id === delta.id);
    if (!widget) return;

    widget.x = typeof delta.x === 'number' ? delta.x : widget.x;
    widget.y = typeof delta.y === 'number' ? delta.y : widget.y;
    widget.width = typeof delta.w === 'number' ? delta.w : widget.width;
    const requestedHeight = typeof delta.h === 'number' ? delta.h : widget.height;
    const isTeacherCompactHeight = !layoutManagerIsTeacherMode()
      && (delta.minimized === true || requestedHeight <= MINIMIZED_WIDGET_HEIGHT);
    widget.height = isTeacherCompactHeight && Number.isFinite(widget.expandedHeight)
      ? widget.expandedHeight
      : requestedHeight;
    if (!this.isWidgetMinimized(widget)) {
      widget.expandedHeight = widget.height;
    }
    this.clampWidgetToContainer(widget);
    this.mountWidgetElement(widget, { preserveStacking: true });
    if (Array.isArray(delta.stackOrder)) {
      this.applyWidgetStackOrder(delta.stackOrder);
    }
    this.scheduleWidgetLayoutHook(widget);
  }

  createWidgetFromType(type) {
    if (typeof window !== 'undefined' && typeof window.createWidgetByType === 'function') {
      return window.createWidgetByType(type);
    }

    console.warn(`Unknown widget type: ${type}`);
    return null;
  }
}

// Ensure the class is available globally before other scripts instantiate it.
if (typeof window !== 'undefined') {
  window.LayoutManager = LayoutManager;
  window.dispatchEvent(new CustomEvent('teacher-screen:layout-manager-ready'));
}
