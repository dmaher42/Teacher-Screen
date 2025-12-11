// js/utils/layout-manager.js

const GRID_SIZE = 20; // Widgets will snap to a 20px grid
const COL_PX_ESTIMATE = 80; // Rough estimate for legacy constraint conversion

const WIDGET_SIZE_RULES = {
  TimerWidget: { minW: 2, minH: 1, maxW: 12, maxH: 4 },
  NoiseMeterWidget: { minW: 2, minH: 2 },
  DocumentViewerWidget: { minW: 3, minH: 3 },
  NamePickerWidget: { minW: 2, minH: 2 },
  WellbeingWidget: { minW: 3, minH: 3 }
};

class LayoutManager {
  constructor(container) {
    this.container = container;
    this.widgets = [];
    // Keep these for legacy reference, though we are free-form now
    this.gridColumns = 12;
    this.gridRows = 8;
    this.draggedWidget = null;
    this.onLayoutChange = null;
    this.isRestoring = false;

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

      this.saveLayout();
    }
  }

  addWidget(widget, x = null, y = null, width = null, height = null) {
     const containerW = this.container.clientWidth || 1024;
     const containerH = this.container.clientHeight || 768;
     const colW = containerW / this.gridColumns;
     const rowH = containerH / this.gridRows;

     // Default size (3x2 grid units approx) if not provided
     let finalW = width !== null ? width : colW * 3;
     let finalH = height !== null ? height : rowH * 2;

     // Heuristic: if width is small (<= 12), assume grid units and convert.
     if (finalW <= 12) finalW = finalW * colW;
     if (finalH <= 12) finalH = finalH * rowH;

     let finalX = x;
     let finalY = y;

     if (finalX === null || finalY === null) {
        // Cascade placement
        const count = this.widgets.length;
        finalX = (count * 40) % (containerW - finalW);
        finalY = (count * 40) % (containerH - finalH);
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

    // Set styles
    widgetElement.style.position = 'absolute';
    widgetElement.style.left = `${finalX}px`;
    widgetElement.style.top = `${finalY}px`;
    widgetElement.style.width = `${finalW}px`;
    widgetElement.style.height = `${finalH}px`;

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
    
    this.container.appendChild(widgetElement);
    
    this.widgets.push({
      element: widgetElement,
      widget: widget,
      x: finalX,
      y: finalY,
      width: finalW,
      height: finalH,
      visibleOnProjector: true
    });

    this.saveLayout();
    return widgetElement;
  }

  createSettingsButton(widget, widgetElement) {
    const settingsButton = document.createElement('button');
    settingsButton.className = 'widget-settings-btn';
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
      widgetInfo.element.remove();
      this.widgets = this.widgets.filter(info => info.widget !== widget);
      this.saveLayout();

      const event = new CustomEvent('widgetRemoved', { detail: { widget } });
      document.dispatchEvent(event);
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

      const minWidth = GRID_SIZE * 4;
      const minHeight = GRID_SIZE * 3;

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

        const info = this.widgets.find(w => w.element === element);
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
        this.saveLayout();
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

        this.saveLayout();
      }
    });
  }
  
  saveLayout() {
    if (this.isRestoring) return;

    const layout = this.serialize();
    const json = JSON.stringify(layout);

    if (json === this.lastSavedLayoutJSON) {
      return;
    }

    this.lastSavedLayoutJSON = json;

    if (this.onLayoutChange) {
      this.onLayoutChange(layout);
    }
  }

  serialize() {
    const widgets = this.widgets.map(widgetInfo => {
      // Return pixels
      return {
        type: widgetInfo.widget.constructor.name,
        x: widgetInfo.x,
        y: widgetInfo.y,
        width: widgetInfo.width,
        height: widgetInfo.height,
        visibleOnProjector: widgetInfo.visibleOnProjector !== false,
        data: widgetInfo.widget.serialize()
      };
    });

    return { widgets };
  }
  
  loadLayout() {
    // This function seems unused as `main.js` calls deserialize directly from `loadSavedState`
    // but we can keep it for consistency.
    const savedLayout = localStorage.getItem('widgetLayout');
    if (savedLayout) {
      this.isRestoring = true;
      try {
        const layout = JSON.parse(savedLayout);
        const layoutData = Array.isArray(layout) ? { widgets: layout } : layout;
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

    this.container.innerHTML = '';
    this.widgets = [];

    const containerW = this.container.clientWidth || 1024;
    const containerH = this.container.clientHeight || 768;
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

      widgetElement.style.position = 'absolute';
      widgetElement.style.left = `${finalX}px`;
      widgetElement.style.top = `${finalY}px`;
      widgetElement.style.width = `${finalW}px`;
      widgetElement.style.height = `${finalH}px`;

      this.createSettingsButton(widget, widgetElement);

      const content = document.createElement('div');
      content.className = 'widget-content';
      content.appendChild(widget.element);

      widgetElement.appendChild(content);

      this.addResizeHandles(widgetElement);
      this.addDragFunctionality(widgetElement);

      this.container.appendChild(widgetElement);

      if (widgetData.data && typeof widget.deserialize === 'function') {
        widget.deserialize(widgetData.data);
      }

      this.widgets.push({
        element: widgetElement,
        widget: widget,
        x: finalX,
        y: finalY,
        width: finalW,
        height: finalH,
        visibleOnProjector: widgetData.visibleOnProjector !== false
      });
    });
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
      case 'MaskWidget':
        return new MaskWidget();
      case 'NotesWidget':
        return new NotesWidget();
      case 'WellbeingWidget':
        return new WellbeingWidget();
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
