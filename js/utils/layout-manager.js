// js/utils/layout-manager.js

const WIDGET_SIZE_RULES = {
  TimerWidget: { minW: 2, minH: 1, maxW: 12, maxH: 4 },
  NoiseMeterWidget: { minW: 2, minH: 2 },
  DocumentViewerWidget: { minW: 3, minH: 3 },
  NamePickerWidget: { minW: 2, minH: 2 }
};

class LayoutManager {
  constructor(container) {
    this.container = container;
    this.widgets = [];
    this.gridColumns = 12;
    this.gridRows = 8;
    this.draggedWidget = null;
    this.onLayoutChange = null;
    this.isRestoring = false;

    // Use global debounce if available (defined in main.js)
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
    // Set up the grid layout
    this.applyGridStyles();
  }

  moveWidgetByDelta(widgetElement, dx, dy) {
    const info = this.widgets.find(w => w.element === widgetElement);
    if (!info) return;

    const newX = Math.max(0, Math.min(this.gridColumns - info.width, info.x + dx));
    const newY = Math.max(0, Math.min(this.gridRows - info.height, info.y + dy));

    if (newX !== info.x || newY !== info.y) {
      info.x = newX;
      info.y = newY;

      info.element.style.gridColumn = `${newX + 1} / span ${info.width}`;
      info.element.style.gridRow = `${newY + 1} / span ${info.height}`;

      this.saveLayout();
    }
  }

  getConstrainedSize(widget, width, height) {
    const type = widget.constructor.name;
    const rules = WIDGET_SIZE_RULES[type];
    if (!rules) return { width, height };

    let w = width;
    let h = height;
    if (rules.minW) w = Math.max(w, rules.minW);
    if (rules.minH) h = Math.max(h, rules.minH);
    if (rules.maxW) w = Math.min(w, rules.maxW);
    if (rules.maxH) h = Math.min(h, rules.maxH);
    return { width: w, height: h };
  }

  applyGridStyles() {
    this.container.style.display = 'grid';
    this.container.style.gridTemplateColumns = `repeat(${this.gridColumns}, 1fr)`;
    this.container.style.gridTemplateRows = `repeat(${this.gridRows}, 1fr)`;
    this.container.style.gap = '10px';
    this.container.style.padding = '10px';
    this.container.style.height = '100%';
  }
  
  addWidget(widget, x = null, y = null, width = 3, height = 2) {
    // Apply size constraints
    const constrained = this.getConstrainedSize(widget, width, height);
    width = constrained.width;
    height = constrained.height;

    let finalX = x;
    let finalY = y;

    if (finalX === null || finalY === null) {
        const widgetCount = this.widgets.length;
        finalX = (widgetCount * width) % this.gridColumns;
        finalY = Math.floor((widgetCount * width) / this.gridColumns) * height;
    }

    // Create widget container
    const widgetElement = document.createElement('div');
    const widgetType = widget.constructor.name.replace(/Widget$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().substring(1);
    widgetElement.className = `widget ${widgetType}-widget`;
    widgetElement.style.gridColumn = `${finalX + 1} / span ${width}`;
    widgetElement.style.gridRow = `${finalY + 1} / span ${height}`;

    // Create Settings Button (Direct Child)
    this.createSettingsButton(widget, widgetElement);

    const content = document.createElement('div');
    content.className = 'widget-content';
    content.appendChild(widget.element);

    widgetElement.appendChild(content);

    // Add resize handles
    this.addResizeHandles(widgetElement);

    // Add drag functionality to the WIDGET ITSELF
    this.addDragFunctionality(widgetElement);
    
    // Add to container
    this.container.appendChild(widgetElement);
    
    // Store widget info
    this.widgets.push({
      element: widgetElement,
      widget: widget,
      x: x,
      y: y,
      width: width,
      height: height,
      visibleOnProjector: true
    });

    // Save layout
    this.saveLayout();

    return widgetElement;
  }

  createSettingsButton(widget, widgetElement) {
    const settingsButton = document.createElement('button');
    settingsButton.className = 'widget-settings-btn';
    settingsButton.innerHTML = '<i class="fas fa-cog"></i>'; // Note: FontAwesome might not be loaded, using fallback/SVG might be safer, but existing code used it?
    // Wait, existing code used `dragHandle.src = 'assets/icons/drag-handle.svg'`.
    // The previous settings button code was: `settingsButton.innerHTML = '<i class="fas fa-cog"></i>';` (Wait, I saw that in my head or in the file?)
    // Let's check `read_file` output for `layout-manager.js`.
    // It used: `settingsButton.innerHTML = '<i class="fas fa-cog"></i>';`. So FA is likely used.
    // I'll stick to that.

    // BUT the user prompt said: "Make a small, subtle settings icon appear...".
    // "Remove the div with the class .widget-tile-header... This includes the icon and the text title".
    // So the previous icon was part of header.
    // I will use a simple SVG or character if FA is not reliable, but since it was there, I assume it's fine.
    // Actually, to be safe and match the prompt "Make a small, subtle settings icon", I'll use a gear emoji or SVG if unsure.
    // I'll use the cog icon as before.

    settingsButton.setAttribute('aria-label', 'Open Settings');
    settingsButton.title = 'Widget Settings';

    settingsButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent drag
        const event = new CustomEvent('openWidgetSettings', { detail: { widget } });
        document.dispatchEvent(event);
    });

    // Also support keyboard activation
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

      // Dispatch a custom event so the main app can update its state
      const event = new CustomEvent('widgetRemoved', { detail: { widget } });
      document.dispatchEvent(event);
    }
  }
  
  addResizeHandles(element) {
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    element.appendChild(resizeHandle);

    let isResizing = false;
    let startX, startY;
    let startWidth, startHeight; // in grid units
    let startPixelWidth, startPixelHeight;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      const computedStyle = window.getComputedStyle(element);
      startPixelWidth = parseInt(computedStyle.width, 10);
      startPixelHeight = parseInt(computedStyle.height, 10);

      const info = this.widgets.find(w => w.element === element);
      if (info) {
          startWidth = info.width;
          startHeight = info.height;
      } else {
          // Fallback if not found (shouldn't happen)
          startWidth = 1;
          startHeight = 1;
      }

      e.preventDefault();
      e.stopPropagation(); // Prevent drag start on resize handle
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Calculate approximate cell size
      const cellWidth = startPixelWidth / startWidth;
      const cellHeight = startPixelHeight / startHeight;

      const gridDeltaX = Math.round(deltaX / cellWidth);
      const gridDeltaY = Math.round(deltaY / cellHeight);

      let newWidth = Math.max(1, startWidth + gridDeltaX);
      let newHeight = Math.max(1, startHeight + gridDeltaY);

      const info = this.widgets.find(w => w.element === element);
      if (info) {
          const constrained = this.getConstrainedSize(info.widget, newWidth, newHeight);

          if (constrained.width !== newWidth || constrained.height !== newHeight) {
             // Visual feedback
             element.classList.add('size-limit-hit');
             setTimeout(() => element.classList.remove('size-limit-hit'), 300);
          }

          newWidth = constrained.width;
          newHeight = constrained.height;

          // Apply new grid span
          const gridColumn = window.getComputedStyle(element).gridColumn;
          const gridRow = window.getComputedStyle(element).gridRow;

          const startCol = parseInt(gridColumn.split('/')[0].trim()) || 1;
          const startRow = parseInt(gridRow.split('/')[0].trim()) || 1;

          // Prevent going out of bounds
          if (startCol + newWidth - 1 > this.gridColumns) {
              newWidth = this.gridColumns - startCol + 1;
          }
          if (startRow + newHeight - 1 > this.gridRows) {
              newHeight = this.gridRows - startRow + 1;
          }

          element.style.gridColumn = `${startCol} / span ${newWidth}`;
          element.style.gridRow = `${startRow} / span ${newHeight}`;

          // Update info
          info.width = newWidth;
          info.height = newHeight;
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        this.saveLayout();
      }
    });
  }
  
  addDragFunctionality(widgetElement) {
    let isDragging = false;
    let startX, startY, initialX, initialY, widgetWidth, widgetHeight;

    const parseGridPosition = (gridValue) => {
      const [startPart, endPart] = (gridValue || '').split('/').map(part => part.trim());
      const start = parseInt(startPart, 10) || 1;
      let span = 1;

      if (endPart) {
        const spanMatch = endPart.match(/span\s+(\d+)/);
        if (spanMatch) {
          span = parseInt(spanMatch[1], 10) || 1;
        } else {
          const end = parseInt(endPart, 10);
          if (!isNaN(end)) {
            span = Math.max(1, end - start);
          }
        }
      }

      return { start, span };
    };

    widgetElement.addEventListener('mousedown', (e) => {
      // Only start dragging if not clicking on a resize handle or input element
      if (e.target.classList.contains('resize-handle') ||
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'BUTTON' ||
          e.target.tagName === 'SELECT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'A' ||
          e.target.closest('button') || // Handle clicks on icons inside buttons
          e.target.closest('input') ||
          e.target.closest('select')) {
        return;
      }

      const widgetInfo = this.widgets.find(w => w.element === widgetElement);

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      // Get current grid position from the widget container
      const computedStyle = window.getComputedStyle(widgetElement);
      const { start: columnStart, span: columnSpan } = parseGridPosition(computedStyle.gridColumn);
      const { start: rowStart, span: rowSpan } = parseGridPosition(computedStyle.gridRow);

      initialX = columnStart - 1;
      initialY = rowStart - 1;
      widgetWidth = widgetInfo?.width || columnSpan;
      widgetHeight = widgetInfo?.height || rowSpan;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      // Calculate new position based on grid cell size
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      const cellWidth = this.container.clientWidth / this.gridColumns;
      const cellHeight = this.container.clientHeight / this.gridRows;

      const gridDeltaX = Math.round(deltaX / (cellWidth || 1));
      const gridDeltaY = Math.round(deltaY / (cellHeight || 1));

      const newX = Math.max(0, Math.min(this.gridColumns - widgetWidth, initialX + gridDeltaX));
      const newY = Math.max(0, Math.min(this.gridRows - widgetHeight, initialY + gridDeltaY));

      widgetElement.style.gridColumn = `${newX + 1} / span ${widgetWidth}`;
      widgetElement.style.gridRow = `${newY + 1} / span ${widgetHeight}`;
    });

    document.addEventListener('mouseup', (e) => {
      if (isDragging) {
        isDragging = false;

        // Update stored widget position for accurate serialization
        const info = this.widgets.find(w => w.element === widgetElement);
        if (info) {
          info.x = parseInt(widgetElement.style.gridColumn, 10) - 1 || 0;
          info.y = parseInt(widgetElement.style.gridRow, 10) - 1 || 0;
          info.width = widgetWidth;
          info.height = widgetHeight;
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
      return; // no change → skip write
    }

    this.lastSavedLayoutJSON = json;

    if (this.onLayoutChange) {
      this.onLayoutChange(layout);
    }
  }

  serialize() {
    const widgets = this.widgets.map(widgetInfo => {
      const computedStyle = window.getComputedStyle(widgetInfo.element);
      const gridColumn = computedStyle.gridColumn;
      const gridRow = computedStyle.gridRow;

      const [columnStart, columnEnd] = gridColumn.split('/').map(part => part.trim());
      const [rowStart, rowEnd] = gridRow.split('/').map(part => part.trim());

      const columnSpanMatch = columnEnd && columnEnd.match(/span\s+(\d+)/);
      const rowSpanMatch = rowEnd && rowEnd.match(/span\s+(\d+)/);

      const x = parseInt(columnStart, 10) - 1;
      const y = parseInt(rowStart, 10) - 1;
      const width = columnSpanMatch ? parseInt(columnSpanMatch[1], 10) : Math.max(1, (parseInt(columnEnd, 10) || 1) - parseInt(columnStart, 10));
      const height = rowSpanMatch ? parseInt(rowSpanMatch[1], 10) : Math.max(1, (parseInt(rowEnd, 10) || 1) - parseInt(rowStart, 10));

      return {
        type: widgetInfo.widget.constructor.name,
        gridColumn,
        gridRow,
        x,
        y,
        width,
        height,
        visibleOnProjector: widgetInfo.visibleOnProjector !== false,
        data: widgetInfo.widget.serialize()
      };
    });

    return { widgets };
  }
  
  loadLayout() {
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

    const parseGridPosition = (gridValue) => {
      const [startPart, endPart] = (gridValue || '').split('/').map(part => part.trim());
      const start = parseInt(startPart, 10) || 1;
      let span = 1;

      if (endPart) {
        const spanMatch = endPart.match(/span\s+(\d+)/);
        if (spanMatch) {
          span = parseInt(spanMatch[1], 10) || 1;
        } else {
          const end = parseInt(endPart, 10);
          if (!isNaN(end)) {
            span = Math.max(1, end - start);
          }
        }
      }

      return { start, span };
    };

    layoutData.widgets.forEach((widgetData) => {
      const widget = widgetFactory ? widgetFactory(widgetData) : this.createWidgetFromType(widgetData.type);
      // Added robustness check: ensure widget and widget.element exist.
      if (!widget || !widget.element) {
        return;
      }

      const widgetElement = document.createElement('div');
      const widgetType = widget.constructor.name.replace(/Widget$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().substring(1);
      widgetElement.className = `widget ${widgetType}-widget`;

      const gridColumn = widgetData.gridColumn || `${(widgetData.x ?? 0) + 1} / span ${widgetData.width ?? 1}`;
      const gridRow = widgetData.gridRow || `${(widgetData.y ?? 0) + 1} / span ${widgetData.height ?? 1}`;
      widgetElement.style.gridColumn = gridColumn;
      widgetElement.style.gridRow = gridRow;

      // Create Settings Button (Direct Child)
      this.createSettingsButton(widget, widgetElement);

      const content = document.createElement('div');
      content.className = 'widget-content';
      content.appendChild(widget.element);

      widgetElement.appendChild(content);

      this.addResizeHandles(widgetElement);
      // Add drag functionality to the WIDGET ITSELF
      this.addDragFunctionality(widgetElement);

      this.container.appendChild(widgetElement);

      if (widgetData.data && typeof widget.deserialize === 'function') {
        widget.deserialize(widgetData.data);
      }

      const columnPosition = parseGridPosition(gridColumn);
      const rowPosition = parseGridPosition(gridRow);

      const x = widgetData.x ?? (columnPosition.start - 1);
      const y = widgetData.y ?? (rowPosition.start - 1);
      const width = widgetData.width ?? columnPosition.span;
      const height = widgetData.height ?? rowPosition.span;
      const visibleOnProjector = widgetData.visibleOnProjector !== false;

      this.widgets.push({
        element: widgetElement,
        widget: widget,
        x,
        y,
        width,
        height,
        visibleOnProjector
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
