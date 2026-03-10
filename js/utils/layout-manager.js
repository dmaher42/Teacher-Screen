// js/utils/layout-manager.js

const GRID_SIZE = 20; // Widgets will snap to a 20px grid
const COL_PX_ESTIMATE = 80; // Rough estimate for legacy constraint conversion
const layoutManagerIsTeacherMode = () => (window.TeacherScreenAppMode ? window.TeacherScreenAppMode.isTeacherMode() : true);
const layoutManagerApplyAppModeToWidget = (widgetInstance) => (window.TeacherScreenAppMode && typeof window.TeacherScreenAppMode.applyAppModeToWidget === 'function'
  ? window.TeacherScreenAppMode.applyAppModeToWidget(widgetInstance)
  : widgetInstance);


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
  TimerWidget: { minW: 3, minH: 2, defaultW: 3, defaultH: 2, maxW: 12, maxH: 4 },
  NoiseMeterWidget: { minW: 3, minH: 3, defaultW: 3, defaultH: 3 },
  DocumentViewerWidget: { minW: 3, minH: 3, defaultW: 6, defaultH: 6 },
  UrlViewerWidget: { minW: 3, minH: 3, defaultW: 3, defaultH: 3 },
  // Reveal manager uses standard grid sizing.
  RevealManagerWidget: { minW: 4, minH: 4, defaultW: 6, defaultH: 6, maxW: 12, maxH: 12 },
  PresentationWidget: { minW: 4, minH: 4, defaultW: 6, defaultH: 6, maxW: 12, maxH: 12 },
  NamePickerWidget: { minW: 3, minH: 2, defaultW: 3, defaultH: 2 },
  WellbeingWidget: { minW: 3, minH: 3, defaultW: 3, defaultH: 3 },
  RichTextWidget: { minW: 4, minH: 3 }
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
    this.widgets.forEach((widgetInfo) => {
      if (widgetInfo.widget && typeof widgetInfo.widget.setEditable === 'function') {
        widgetInfo.widget.setEditable(this.editable);
      }
    });
  }

  init() {
    this.applyGridStyles();
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
    this.onLayoutChange({
      type: 'widget-update',
      id: widgetInfo.id,
      x: widgetInfo.x,
      y: widgetInfo.y,
      w: widgetInfo.width,
      h: widgetInfo.height
    });
  }

  mountWidgetElement(widgetInfo) {
    const { element, layoutType } = widgetInfo;
    if (this.mode !== 'stage') {
      element.style.position = 'absolute';
      element.style.left = `${widgetInfo.x}px`;
      element.style.top = `${widgetInfo.y}px`;
      element.style.width = `${widgetInfo.width}px`;
      element.style.height = `${widgetInfo.height}px`;
      this.container.appendChild(element);
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
      this.stageMain.appendChild(element);
      return;
    }

    if (layoutManagerIsTeacherMode() && layoutType === 'stage') {
      element.style.position = 'absolute';
      element.style.left = '0';
      element.style.top = '0';
      element.style.width = '100%';
      element.style.height = '100%';
      this.stageMain.appendChild(element);
      return;
    }

    element.style.position = 'relative';
    element.style.left = '';
    element.style.top = '';
    element.style.width = '100%';
    element.style.height = `${Math.max(widgetInfo.height, GRID_SIZE * 6)}px`;
    this.stageSidebar.appendChild(element);
  }

  getConstrainedSize(widget, widthPx, heightPx) {
    // Convert rules to pixels roughly
    const type = widget.constructor.name;
    const rules = WIDGET_SIZE_RULES[type];
    if (!rules) return { width: widthPx, height: heightPx };

    // Approximation of column size
    const colSize = this.container.clientWidth / this.gridColumns || 80;
    const rowSize = this.container.clientHeight / this.gridRows || 80;

    let w = widthPx;
    let h = heightPx;

    if (rules.minW) w = Math.max(w, rules.minW * colSize);
    if (rules.minH) h = Math.max(h, rules.minH * rowSize);
    // Remove max constraints for more freedom, or adapt them?
    // Let's keep min constraints but be lenient on max.

    return { width: w, height: h };
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
    newX = Math.max(0, Math.min(this.container.clientWidth - info.width, newX));
    newY = Math.max(0, Math.min(this.container.clientHeight - info.height, newY));

    // Snap
    newX = Math.round(newX / GRID_SIZE) * GRID_SIZE;
    newY = Math.round(newY / GRID_SIZE) * GRID_SIZE;

    if (newX !== info.x || newY !== info.y) {
      info.x = newX;
      info.y = newY;

      info.element.style.left = `${newX}px`;
      info.element.style.top = `${newY}px`;

      this.emitWidgetUpdate(info);
      this.saveLayout({ emitFull: false });
    }
  }

  addWidget(widget, x = null, y = null, width = null, height = null) {
    layoutManagerApplyAppModeToWidget(widget);
     const containerW = this.container.clientWidth || 1024;
     const containerH = this.container.clientHeight || 768;
     const colW = containerW / this.gridColumns;
     const rowH = containerH / this.gridRows;
     const rules = WIDGET_SIZE_RULES[widget.constructor.name] || {};
     const defaultW = rules.defaultW || 3;
     const defaultH = rules.defaultH || 2;
     const maxCols = 3;

     // Default size uses widget-specific grid unit defaults when not provided.
     let finalW = width !== null ? width : colW * defaultW;
     let finalH = height !== null ? height : rowH * defaultH;

     // Heuristic: if width is small (<= 12), assume grid units and convert.
     if (finalW <= 12) finalW = finalW * colW;
     if (finalH <= 12) finalH = finalH * rowH;

     let finalX = x;
     let finalY = y;

     if (finalX === null || finalY === null) {
        // Place widgets in a row-by-row grid to avoid cascade overlap.
        const count = this.widgets.length;
        const col = count % maxCols;
        const row = Math.floor(count / maxCols);
        finalX = col * (colW * defaultW + GRID_SIZE);
        finalY = row * (rowH * defaultH + GRID_SIZE);
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

    // Create widget container
    const widgetElement = document.createElement('div');
    const widgetType = widget.constructor.name.replace(/Widget$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().substring(1);
    widgetElement.className = `widget ${widgetType}-widget`;

    // Clear grid styles
    widgetElement.style.gridColumn = '';
    widgetElement.style.gridRow = '';

    this.createSettingsButton(widget, widgetElement);

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
      visibleOnProjector: true
    };

    this.widgets.push(widgetInfo);
    this.mode = layoutManagerIsTeacherMode() && this.widgets.some((info) => info.layoutType === 'stage') ? 'stage' : 'dashboard';
    this.setupModeStructure();
    this.widgets.forEach((info) => this.mountWidgetElement(info));

    if (typeof widget.setEditable === 'function') {
      widget.setEditable(this.editable);
    }

    this.saveLayout();
    return widgetElement;
  }

  createSettingsButton(widget, widgetElement) {
    const settingsButton = document.createElement('button');
    settingsButton.className = 'widget-settings-btn secondary-control';
    settingsButton.innerHTML = '<i class="fas fa-cog"></i>';
    settingsButton.setAttribute('aria-label', 'Open Settings');
    settingsButton.title = 'Widget Settings';

    settingsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const event = new CustomEvent('openWidgetSettings', { detail: { widget } });
        document.dispatchEvent(event);
    });

    settingsButton.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
             const event = new CustomEvent('openWidgetSettings', { detail: { widget } });
            document.dispatchEvent(event);
        }
    });

    widgetElement.appendChild(settingsButton);
  }

  removeWidget(widget) {
    const widgetInfo = this.widgets.find(info => info.widget === widget);
    if (widgetInfo) {
      let widgetRemovedEventDispatched = false;

      const trackWidgetRemoved = (event) => {
        if (event && event.detail && event.detail.widget === widget) {
          widgetRemovedEventDispatched = true;
        }
      };

      document.addEventListener('widgetRemoved', trackWidgetRemoved);

      if (widget && typeof widget.remove === 'function') {
        widget.remove();
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
      const rules = info ? WIDGET_SIZE_RULES[info.widget.constructor.name] || {} : {};
      const colW = this.container.clientWidth / this.gridColumns || COL_PX_ESTIMATE;
      const rowH = this.container.clientHeight / this.gridRows || COL_PX_ESTIMATE;
      const minWidth = Math.round((rules.minW ? rules.minW * colW : GRID_SIZE * 4) / GRID_SIZE) * GRID_SIZE;
      const minHeight = Math.round((rules.minH ? rules.minH * rowH : GRID_SIZE * 3) / GRID_SIZE) * GRID_SIZE;

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

        const maxLeft = Math.max(0, this.container.clientWidth - newWidth);
        const maxTop = Math.max(0, this.container.clientHeight - newHeight);

        newLeft = Math.min(Math.max(0, newLeft), maxLeft);
        newTop = Math.min(Math.max(0, newTop), maxTop);

        newWidth = Math.round(newWidth / GRID_SIZE) * GRID_SIZE;
        newHeight = Math.round(newHeight / GRID_SIZE) * GRID_SIZE;
        newLeft = Math.round(newLeft / GRID_SIZE) * GRID_SIZE;
        newTop = Math.round(newTop / GRID_SIZE) * GRID_SIZE;

        element.style.width = `${newWidth}px`;
        element.style.height = `${newHeight}px`;
        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;

        if (info) {
          info.width = newWidth;
          info.height = newHeight;
          info.x = newLeft;
          info.y = newTop;
        }
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        this.emitWidgetUpdate(info);
        this.saveLayout({ emitFull: false });
      };

      e.preventDefault();
      e.stopPropagation();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    element.addEventListener('mousedown', onMouseDown);
  }

  addDragFunctionality(widgetElement) {
    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop;

    widgetElement.addEventListener('mousedown', (e) => {
      if (!this.editable) return;

      if (e.target.classList.contains('resize-handle') ||
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'BUTTON' ||
          e.target.tagName === 'SELECT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'A' ||
          e.target.closest('button') ||
          e.target.closest('input') ||
          e.target.closest('select')) {
        return;
      }

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      initialLeft = parseInt(widgetElement.style.left, 10) || 0;
      initialTop = parseInt(widgetElement.style.top, 10) || 0;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let left = initialLeft + deltaX;
      let top = initialTop + deltaY;

      // Calculate the snapped position
      const snappedLeft = Math.round(left / GRID_SIZE) * GRID_SIZE;
      const snappedTop = Math.round(top / GRID_SIZE) * GRID_SIZE;

      // Apply the snapped position to the widget
      widgetElement.style.left = `${snappedLeft}px`;
      widgetElement.style.top = `${snappedTop}px`;
    });

    document.addEventListener('mouseup', (e) => {
      if (isDragging) {
        isDragging = false;

        const finalLeft = parseInt(widgetElement.style.left, 10) || 0;
        const finalTop = parseInt(widgetElement.style.top, 10) || 0;

        const snappedLeft = Math.round(finalLeft / GRID_SIZE) * GRID_SIZE;
        const snappedTop = Math.round(finalTop / GRID_SIZE) * GRID_SIZE;

        widgetElement.style.left = `${snappedLeft}px`;
        widgetElement.style.top = `${snappedTop}px`;

        const info = this.widgets.find(w => w.element === widgetElement);
        if (info) {
          info.x = snappedLeft;
          info.y = snappedTop;
        }

        this.emitWidgetUpdate(info);
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
  }

  serialize() {
    const widgets = this.widgets.map(widgetInfo => {
      // Return pixels
      return {
        id: widgetInfo.id,
        type: widgetInfo.widget.constructor.name,
        layoutType: widgetInfo.layoutType || 'grid',
        x: widgetInfo.x,
        y: widgetInfo.y,
        width: widgetInfo.width,
        height: widgetInfo.height,
        visibleOnProjector: widgetInfo.visibleOnProjector !== false,
        data: widgetInfo.widget.serialize()
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
    this.setupModeStructure();
    this.widgets = [];

    const containerW = this.container.clientWidth || 1024;
    const containerH = this.container.clientHeight || 768;
    const sourceViewportW = layoutData.viewport && Number(layoutData.viewport.width) > 0
      ? Number(layoutData.viewport.width)
      : containerW;
    const sourceViewportH = layoutData.viewport && Number(layoutData.viewport.height) > 0
      ? Number(layoutData.viewport.height)
      : containerH;
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

      // Default fallback
      if (finalW == null) finalW = colW * 3;
      if (finalH == null) finalH = rowH * 2;
      if (finalX == null) finalX = 0;
      if (finalY == null) finalY = 0;

      // Snap
      finalX = Math.round(finalX / GRID_SIZE) * GRID_SIZE;
      finalY = Math.round(finalY / GRID_SIZE) * GRID_SIZE;
      finalW = Math.round(finalW / GRID_SIZE) * GRID_SIZE;
      finalH = Math.round(finalH / GRID_SIZE) * GRID_SIZE;

      const widgetElement = document.createElement('div');
      const widgetType = widget.constructor.name.replace(/Widget$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().substring(1);
      widgetElement.className = `widget ${widgetType}-widget`;

      this.createSettingsButton(widget, widgetElement);

      const content = document.createElement('div');
      content.className = 'widget-content';
      content.appendChild(widget.element);

      widgetElement.appendChild(content);

      this.addResizeHandles(widgetElement);
      this.addDragFunctionality(widgetElement);

      if (widgetData.data && typeof widget.deserialize === 'function') {
        widget.deserialize(widgetData.data);
      }

      this.widgets.push({
        id: widgetData.id || this.getNextWidgetId(),
        element: widgetElement,
        widget: widget,
        layoutType: this.getWidgetLayoutType(widgetData, widget),
        x: finalX,
        y: finalY,
        width: finalW,
        height: finalH,
        visibleOnProjector: widgetData.visibleOnProjector !== false
      });

      if (typeof widget.setEditable === 'function') {
        widget.setEditable(this.editable);
      }
    });

    this.widgets.forEach((widgetInfo) => this.mountWidgetElement(widgetInfo));
  }

  applyLayoutDelta(delta) {
    if (!delta || delta.type !== 'widget-update') return;
    const widget = this.widgets.find((w) => w.id === delta.id);
    if (!widget) return;

    widget.x = typeof delta.x === 'number' ? delta.x : widget.x;
    widget.y = typeof delta.y === 'number' ? delta.y : widget.y;
    widget.width = typeof delta.w === 'number' ? delta.w : widget.width;
    widget.height = typeof delta.h === 'number' ? delta.h : widget.height;
    this.mountWidgetElement(widget);
  }

  createWidgetFromType(type) {
    switch (type) {
      case 'TimerWidget':
        return new TimerWidget();
      case 'NoiseMeterWidget':
        return new NoiseMeterWidget();
      case 'NamePickerWidget':
        return new NamePickerWidget();
      case 'QRCodeWidget':
        return new QRCodeWidget();
      case 'DrawingToolWidget':
        return new DrawingToolWidget();
      case 'DocumentViewerWidget':
        return new DocumentViewerWidget();
      case 'UrlViewerWidget':
        return new UrlViewerWidget();
      case 'PresentationWidget':
        return new PresentationWidget();
      case 'MaskWidget':
        return new MaskWidget();
      case 'NotesWidget':
        return new NotesWidget();
      case 'WellbeingWidget':
        return new WellbeingWidget();
      case 'RichTextWidget':
        return new RichTextWidget();
      default:
        console.warn(`Unknown widget type: ${type}`);
        return null;
    }
  }
}

// Ensure the class is available globally before other scripts instantiate it.
if (typeof window !== 'undefined') {
  window.LayoutManager = LayoutManager;
}
