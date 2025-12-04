class DrawingTool {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.isDrawing = false;
    this.currentColor = '#000000';
    this.currentLineWidth = 2;
    
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDrawing = true;
      const rect = this.canvas.getBoundingClientRect();
      this.ctx.beginPath();
      this.ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    });
    
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isDrawing) return;
      const rect = this.canvas.getBoundingClientRect();
      this.ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      this.ctx.strokeStyle = this.currentColor;
      this.ctx.lineWidth = this.currentLineWidth;
      this.ctx.stroke();
    });
    
    this.canvas.addEventListener('mouseup', () => {
      this.isDrawing = false;
    });
    
    this.canvas.addEventListener('mouseleave', () => {
      this.isDrawing = false;
    });
  }
  
  setColor(color) {
    this.currentColor = color;
  }
  
  setLineWidth(width) {
    this.currentLineWidth = width;
  }
  
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
