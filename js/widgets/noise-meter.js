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

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const horizontalPadding = Math.max(8, Math.round(canvasWidth * 0.025));
    const verticalPadding = Math.max(8, Math.round(canvasHeight * 0.12));
    const segmentCount = canvasWidth < 260 ? 12 : 18;
    const gap = Math.max(3, Math.round(canvasWidth * 0.012));
    const availableWidth = Math.max(1, canvasWidth - (horizontalPadding * 2) - (gap * (segmentCount - 1)));
    const segmentWidth = availableWidth / segmentCount;
    const segmentHeight = Math.max(12, canvasHeight - (verticalPadding * 2));
    const displayRatio = Math.min(1, average / 190);
    const activeSegments = average > 0 ? Math.max(1, Math.ceil(displayRatio * segmentCount)) : 0;
    const zoneColors = [
      { active: '#22c55e', idle: 'rgba(34, 197, 94, 0.18)' },
      { active: '#fbbf24', idle: 'rgba(251, 191, 36, 0.16)' },
      { active: '#fb4f5f', idle: 'rgba(251, 79, 95, 0.16)' }
    ];

    this.lastRenderedWidth = displayRatio * canvasWidth;

    for (let index = 0; index < segmentCount; index += 1) {
      const zoneIndex = Math.min(2, Math.floor((index / segmentCount) * 3));
      const isActive = index < activeSegments;
      const x = horizontalPadding + (index * (segmentWidth + gap));
      const radius = Math.min(8, segmentWidth / 2, segmentHeight / 2);

      this.ctx.save();
      this.ctx.fillStyle = isActive ? zoneColors[zoneIndex].active : zoneColors[zoneIndex].idle;
      if (isActive) {
        this.ctx.shadowColor = zoneColors[zoneIndex].active;
        this.ctx.shadowBlur = average >= 150 ? 16 : 9;
      }
      this.roundedRect(x, verticalPadding, segmentWidth, segmentHeight, radius);
      this.ctx.fill();
      this.ctx.restore();
    }
  }

  roundedRect(x, y, width, height, radius) {
    this.ctx.beginPath();
    if (typeof this.ctx.roundRect === 'function') {
      this.ctx.roundRect(x, y, width, height, radius);
      return;
    }
    this.ctx.moveTo(x + radius, y);
    this.ctx.lineTo(x + width - radius, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.ctx.lineTo(x + width, y + height - radius);
    this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    this.ctx.lineTo(x + radius, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.ctx.lineTo(x, y + radius);
    this.ctx.quadraticCurveTo(x, y, x + radius, y);
    this.ctx.closePath();
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
