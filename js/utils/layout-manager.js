// js/utils/layout-manager.js
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
  
  addWidget(widget, x = 0, y = 0, width = 3, height = 2) {
    // Create widget container
    const widgetElement = document.createElement('div');
    widgetElement.className = 'widget';
    widgetElement.style.gridColumn = `${x+1} / span ${width}`;
    widgetElement.style.gridRow = `${y+1} / span ${height}`;
    
    // Add widget content
    widgetElement.appendChild(widget.element);
    
    // Add resize handles
    this.addResizeHandles(widgetElement);
    
    // Add drag functionality
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
      height: height
    });

    // Save layout
    this.saveLayout();
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
      element.style.width = (startWidth + e.clientX - startX) + 'px';
      element.style.height = (startHeight + e.clientY - startY) + 'px';
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
      
      // Get current grid position
      const computedStyle = window.getComputedStyle(element);
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
      
      element.style.gridColumn = `${newX+1} / span 3`;
      element.style.gridRow = `${newY+1} / span 2`;
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
        x,
        y,
        width,
        height,
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

  serialize() {
    return {
      widgets: this.widgets.map(widgetInfo => {
        const computedStyle = window.getComputedStyle(widgetInfo.element);
        return {
          type: widgetInfo.widget.constructor.name,
          gridColumn: computedStyle.gridColumn,
          gridRow: computedStyle.gridRow,
          data: widgetInfo.widget.serialize()
        };
      })
    };
  }

  deserialize(layoutData, widgetFactory) {
    if (!layoutData || !Array.isArray(layoutData.widgets)) {
      return;
    }

    this.container.innerHTML = '';
    this.widgets = [];

    layoutData.widgets.forEach((widgetData) => {
      const widget = widgetFactory ? widgetFactory(widgetData) : this.createWidgetFromType(widgetData.type);
      if (!widget) {
        return;
      }

      const widgetElement = document.createElement('div');
      widgetElement.className = 'widget';

      const gridColumn = widgetData.gridColumn || `${(widgetData.x ?? 0) + 1} / span ${widgetData.width ?? 1}`;
      const gridRow = widgetData.gridRow || `${(widgetData.y ?? 0) + 1} / span ${widgetData.height ?? 1}`;
      widgetElement.style.gridColumn = gridColumn;
      widgetElement.style.gridRow = gridRow;

      widgetElement.appendChild(widget.element);
      this.addResizeHandles(widgetElement);
      this.addDragFunctionality(widgetElement);
      this.container.appendChild(widgetElement);

      if (widgetData.data && typeof widget.deserialize === 'function') {
        widget.deserialize(widgetData.data);
      }

      const x = widgetData.x ?? (parseInt(gridColumn, 10) - 1) || 0;
      const y = widgetData.y ?? (parseInt(gridRow, 10) - 1) || 0;
      const width = widgetData.width ?? 1;
      const height = widgetData.height ?? 1;

      this.widgets.push({
        element: widgetElement,
        widget: widget,
        x,
        y,
        width,
        height
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
