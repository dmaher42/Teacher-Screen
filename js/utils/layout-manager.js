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
  }

  init() {
    // Set up the grid layout
    this.applyGridStyles();
  }

  applyGridStyles() {
    this.container.style.display = 'grid';
    this.container.style.gridTemplateColumns = `repeat(${this.gridColumns}, 1fr)`;
    this.container.style.gridTemplateRows = `repeat(${this.gridRows}, 1fr)`;
    this.container.style.gap = '10px';
    this.container.style.padding = '10px';
    this.container.style.height = '100%';
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

  addWidget(widget, x = null, y = null, width = 3, height = 2) {
    let finalX = x;
    let finalY = y;

    if (finalX === null || finalY === null) {
        const widgetCount = this.widgets.length;
        finalX = (widgetCount * width) % this.gridColumns;
        finalY = Math.floor((widgetCount * width) / this.gridColumns) * height;
    }

    const constrained = this.getConstrainedSize(widget, width, height);
    width = constrained.width;
    height = constrained.height;

    // Create widget container
    const widgetElement = document.createElement('div');
    const widgetType = widget.constructor.name.replace(/Widget$/, '').replace(/([A-Z])/g, '-$1').toLowerCase().substring(1);
    widgetElement.className = `widget ${widgetType}-widget`;
    widgetElement.style.gridColumn = `${finalX + 1} / span ${width}`;
    widgetElement.style.gridRow = `${finalY + 1} / span ${height}`;

    const header = this.createWidgetHeader(widget);
    const content = document.createElement('div');
    content.className = 'widget-content';
    content.appendChild(widget.element);

    widgetElement.appendChild(header);
    widgetElement.appendChild(content);

    // Add resize handles
    this.addResizeHandles(widgetElement);

    // Add drag functionality to the header
    this.addDragFunctionality(header);
    
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

  createWidgetHeader(widget) {
    const header = document.createElement('div');
    header.className = 'widget-header';

    // Drag Handle
    const dragHandle = document.createElement('img');
    dragHandle.src = 'assets/icons/drag-handle.svg';
    dragHandle.className = 'widget-drag-handle';
    dragHandle.alt = 'Drag';

    // Title
    const title = document.createElement('div');
    title.className = 'widget-title';
    // Derive title from the widget's class name (e.g., "TimerWidget" -> "Timer")
    title.textContent = widget.constructor.name.replace('Widget', '');

    // Controls
    const controls = document.createElement('div');
    controls.className = 'widget-controls';

    const projectorToggle = document.createElement('button');
    projectorToggle.className = 'widget-projector-toggle';
    projectorToggle.title = 'Toggle visibility on projector';
    projectorToggle.textContent = '🎥';
    projectorToggle.addEventListener('click', () => {
      const info = this.widgets.find(w => w.element === header.parentElement);
      if (!info) return;
      info.visibleOnProjector = !info.visibleOnProjector;
      projectorToggle.classList.toggle('off', !info.visibleOnProjector);
      this.saveLayout();
    });

    const helpButton = document.createElement('button');
    helpButton.className = 'widget-help';
    helpButton.textContent = '?';
    helpButton.addEventListener('click', () => {
      if (typeof widget.toggleHelp === 'function') {
        widget.toggleHelp();
      }
    });

    const closeButton = document.createElement('button');
    closeButton.className = 'widget-close';
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', () => this.removeWidget(widget));

    controls.appendChild(projectorToggle);
    controls.appendChild(helpButton);
    controls.appendChild(closeButton);

    header.appendChild(dragHandle);
    header.appendChild(title);
    header.appendChild(controls);

    return header;
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
    let startX, startY, startWidth, startHeight;
    
    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = parseInt(document.defaultView.getComputedStyle(element).width, 10);
      startHeight = parseInt(document.defaultView.getComputedStyle(element).height, 10);
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const currentWidth = startWidth + e.clientX - startX;
      const currentHeight = startHeight + e.clientY - startY;

      const info = this.widgets.find(w => w.element === element);
      if (info) {
          // Approximate grid unit size
          const containerWidth = this.container.clientWidth - 20;
          const colWidth = (containerWidth - (11 * 10)) / 12;
          // height: 100% of container, split into 8 rows
          const containerHeight = this.container.clientHeight - 20;
          const cellHeight = (containerHeight - (7 * 10)) / 8;

          let newGridW = Math.round(currentWidth / (colWidth + 10));
          let newGridH = Math.round(currentHeight / (cellHeight + 10));

          // Clamp grid units
          const constrained = this.getConstrainedSize(info.widget, Math.max(1, newGridW), Math.max(1, newGridH));

          if (constrained.width !== newGridW || constrained.height !== newGridH) {
             element.classList.add('size-limit-hit');
             setTimeout(() => element.classList.remove('size-limit-hit'), 300);
          }

          const rules = WIDGET_SIZE_RULES[info.widget.constructor.name] || {};
          const minW = rules.minW || 1;
          const minH = rules.minH || 1;
          const maxW = rules.maxW || 12;
          const maxH = rules.maxH || 8;

          const minPixelW = minW * colWidth + (minW - 1) * 10;
          const minPixelH = minH * cellHeight + (minH - 1) * 10;
          const maxPixelW = maxW * colWidth + (maxW - 1) * 10;
          const maxPixelH = maxH * cellHeight + (maxH - 1) * 10;

          let finalPixelW = Math.max(minPixelW, Math.min(maxPixelW, currentWidth));
          let finalPixelH = Math.max(minPixelH, Math.min(maxPixelH, currentHeight));

          if (finalPixelW !== currentWidth || finalPixelH !== currentHeight) {
             element.classList.add('size-limit-hit');
          } else {
             element.classList.remove('size-limit-hit');
          }

          element.style.width = finalPixelW + 'px';
          element.style.height = finalPixelH + 'px';
      } else {
          element.style.width = currentWidth + 'px';
          element.style.height = currentHeight + 'px';
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        this.saveLayout();
      }
    });
  }
  
  addDragFunctionality(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;
    
    // Fix: Find the actual widget element if 'element' is just a handle (header)
    const widgetElement = element.classList.contains('widget') ? element : element.closest('.widget');
    // If we can't find widget element (shouldn't happen), fallback to element
    const targetElement = widgetElement || element;

    element.addEventListener('mousedown', (e) => {
      // Only start dragging if not clicking on a resize handle or input element
      if (e.target.classList.contains('resize-handle') || 
          e.target.tagName === 'INPUT' || 
          e.target.tagName === 'BUTTON' || 
          e.target.tagName === 'SELECT') {
        return;
      }
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      // Get current grid position of the target widget
      const computedStyle = window.getComputedStyle(targetElement);
      const gridColumn = computedStyle.gridColumn;
      const gridRow = computedStyle.gridRow;
      
      // Parse grid position (simplified)
      const columnParts = gridColumn.split(' ');
      initialX = parseInt(columnParts[0]) - 1;
      
      const rowParts = gridRow.split(' ');
      initialY = parseInt(rowParts[0]) - 1;
      
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      // Calculate new position (simplified)
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      // Convert pixel delta to grid units (simplified)
      const gridDeltaX = Math.round(deltaX / 100);
      const gridDeltaY = Math.round(deltaY / 100);
      
      const newX = Math.max(0, Math.min(this.gridColumns - 3, initialX + gridDeltaX));
      const newY = Math.max(0, Math.min(this.gridRows - 2, initialY + gridDeltaY));
      
      targetElement.style.gridColumn = `${newX+1} / span 3`;
      targetElement.style.gridRow = `${newY+1} / span 2`;
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        this.saveLayout();
      }
    });
  }
  
  saveLayout() {
    if (this.isRestoring) return;

    const layout = this.serialize();

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

      const header = this.createWidgetHeader(widget);
      const content = document.createElement('div');
      content.className = 'widget-content';
      content.appendChild(widget.element);

      widgetElement.appendChild(header);
      widgetElement.appendChild(content);

      this.addResizeHandles(widgetElement);
      // Here we pass 'header' to keep consistent with addWidget, but we rely on fixed addDragFunctionality to find the widget
      this.addDragFunctionality(header);
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

      // Update projector toggle state
      const projectorToggle = header.querySelector('.widget-projector-toggle');
      if (projectorToggle) {
        projectorToggle.classList.toggle('off', !visibleOnProjector);
      }

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
