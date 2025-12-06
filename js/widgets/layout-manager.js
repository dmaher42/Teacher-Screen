// js/utils/layout-manager.js
class LayoutManager {
  constructor(container) {
    this.container = container;
    this.widgets = [];
    this.gridColumns = 12;
    this.gridRows = 8;
    this.draggedWidget = null;
  }
  
  init() {
    // Set up the grid layout
    this.container.style.display = 'grid';
    this.container.style.gridTemplateColumns = `repeat(${this.gridColumns}, 1fr)`;
    this.container.style.gridTemplateRows = `repeat(${this.gridRows}, 1fr)`;
    this.container.style.gap = '10px';
    this.container.style.padding = '10px';
    this.container.style.height = '100%';
    
    // Load saved layout if available
    this.loadLayout();
  }
  
  addWidget(widget, x = 0, y = 0, width = 3, height = 2) {
    // Create widget container and header
    const widgetElement = document.createElement('div');
    widgetElement.className = 'widget';
    widgetElement.style.gridColumn = `${x+1} / span ${width}`;
    widgetElement.style.gridRow = `${y+1} / span ${height}`;

    const header = this.createWidgetHeader(widget);
    const content = document.createElement('div');
    content.className = 'widget-content';
    content.appendChild(widget.element);

    widgetElement.appendChild(header);
    widgetElement.appendChild(content);

    // Add resize and drag functionality
    this.addResizeHandles(widgetElement);
    this.addDragFunctionality(header); // Drag by the header

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

    controls.appendChild(helpButton);
    controls.appendChild(closeButton);

    header.appendChild(dragHandle);
    header.appendChild(title);
    header.appendChild(controls);

    return header;
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
    const layout = this.widgets.map(widgetInfo => {
      const computedStyle = window.getComputedStyle(widgetInfo.element);
      const gridColumn = computedStyle.gridColumn;
      const gridRow = computedStyle.gridRow;
      
      return {
        type: widgetInfo.widget.constructor.name,
        gridColumn,
        gridRow,
        data: widgetInfo.widget.serialize()
      };
    });
    
    localStorage.setItem('widgetLayout', JSON.stringify(layout));
  }
  
  loadLayout() {
    const savedLayout = localStorage.getItem('widgetLayout');
    if (savedLayout) {
      try {
        const layout = JSON.parse(savedLayout);
        // Recreate widgets based on saved layout
        // This would need to be implemented based on your specific widgets
      } catch (e) {
        console.error('Failed to load layout:', e);
      }
    }
  }
}
