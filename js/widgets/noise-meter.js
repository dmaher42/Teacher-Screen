class NoiseMeter {
  constructor(canvasElement, onLevel = null) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.onLevel = typeof onLevel === 'function' ? onLevel : null;
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.stream = null;
    this.dataArray = null;
    this.animationFrameId = null;
    this.running = false;
    this.lastLevel = 0;
    this.lastRenderedWidth = 0;
  }
  
  async start() {
    try {
      this.stop();
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = this.audioContext || new AudioContextClass();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.analyser = this.audioContext.createAnalyser();
      this.microphone = this.audioContext.createMediaStreamSource(this.stream);
      this.microphone.connect(this.analyser);
      this.analyser.fftSize = 256;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.running = true;
      this.draw();
    } catch (err) {
      console.error('Error accessing microphone:', err);
      this.stop();
      throw err;
    }
  }
  
  draw() {
    if (!this.running || !this.analyser || !this.dataArray) return;

    this.analyser.getByteFrequencyData(this.dataArray);
    const average = this.dataArray.reduce((a, b) => a + b) / this.dataArray.length;
    this.renderLevel(average);
    if (this.onLevel) this.onLevel(average);
    this.animationFrameId = requestAnimationFrame(() => this.draw());
  }

  renderLevel(level = 0) {
    const average = Math.min(255, Math.max(0, Number(level) || 0));
    this.lastLevel = average;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw meter
    const width = (average / 255) * this.canvas.width;
    this.lastRenderedWidth = width;
    
    // Color based on noise level
    if (average < 50) {
      this.ctx.fillStyle = '#4CAF50'; // Green
    } else if (average < 150) {
      this.ctx.fillStyle = '#FFC107'; // Yellow
    } else {
      this.ctx.fillStyle = '#F44336'; // Red
    }
    
    this.ctx.fillRect(0, 0, width, this.canvas.height);
  }

  stop() {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    try {
      this.microphone?.disconnect?.();
    } catch (_error) {
      // The source may already be disconnected.
    }
    this.microphone = null;
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    this.analyser = null;
    this.dataArray = null;
    this.renderLevel(0);
  }

  destroy() {
    this.stop();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
    }
    this.audioContext = null;
  }
}
