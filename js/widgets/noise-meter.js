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
    this.backgroundSampleTimerId = null;
    this.running = false;
    this.lastLevel = 0;
    this.displayMode = 'compact';
    this.tooLoudThreshold = 150;
    this.levelHistory = [];
    this.historyWindowMs = 30000;
    this.historySampleIntervalMs = 250;
    this.lastHistorySampleAt = 0;
    this.lastRenderedWidth = 0;
    this.handleVisibilityChange = this.onVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }
  
  async start() {
    try {
      this.stop();
      if (!window.isSecureContext) {
        const error = new Error('Microphone access requires a secure page.');
        error.name = 'InsecureContextError';
        throw error;
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        const error = new Error('This browser does not provide microphone access.');
        error.name = 'NotSupportedError';
        throw error;
      }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        const error = new Error('This browser does not support live audio analysis.');
        error.name = 'NotSupportedError';
        throw error;
      }
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
    this.scheduleNextSample();
  }

  scheduleNextSample() {
    this.cancelScheduledSample();
    if (!this.running) return;

    if (document.visibilityState === 'hidden') {
      // Browsers pause requestAnimationFrame for background tabs and minimised
      // windows. Keep sampling while the microphone is active so the separate
      // projector window continues receiving live readings.
      this.backgroundSampleTimerId = window.setTimeout(() => {
        this.backgroundSampleTimerId = null;
        this.draw();
      }, 100);
      return;
    }

    this.animationFrameId = requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.draw();
    });
  }

  cancelScheduledSample() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.backgroundSampleTimerId !== null) {
      window.clearTimeout(this.backgroundSampleTimerId);
      this.backgroundSampleTimerId = null;
    }
  }

  onVisibilityChange() {
    if (!this.running) return;
    this.draw();
  }

  playWarningTone() {
    const context = this.audioContext;
    if (!context || context.state !== 'running') return false;

    const startAt = context.currentTime + 0.02;
    [0, 0.18].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = startAt + offset;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(index === 0 ? 660 : 820, toneStart);
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(0.16, toneStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + 0.13);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneStart + 0.14);
    });
    return true;
  }

  setDisplayMode(mode = 'compact') {
    const allowedModes = new Set(['compact', 'gauge', 'timeline']);
    this.displayMode = allowedModes.has(mode) ? mode : 'compact';
    this.renderLevel(this.lastLevel, { record: false });
  }

  setNoiseThreshold(value = 150) {
    this.tooLoudThreshold = Math.min(200, Math.max(80, Number(value) || 150));
    this.renderLevel(this.lastLevel, { record: false });
  }

  recordLevel(level, sampledAt = Date.now()) {
    const lastSample = this.levelHistory[this.levelHistory.length - 1];
    if (lastSample && sampledAt - this.lastHistorySampleAt < this.historySampleIntervalMs) {
      lastSample.value = level;
      return;
    }

    this.levelHistory.push({ time: sampledAt, value: level });
    this.lastHistorySampleAt = sampledAt;
    const cutoff = sampledAt - this.historyWindowMs;
    while (this.levelHistory.length > 1 && this.levelHistory[0].time < cutoff) {
      this.levelHistory.shift();
    }
  }

  getRecentStats() {
    const values = this.levelHistory.length
      ? this.levelHistory.map((sample) => sample.value)
      : [this.lastLevel];
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      peak: Math.max(...values),
      average: total / values.length
    };
  }

  toDisplayLevel(level = 0) {
    return Math.round(Math.min(100, Math.max(0, (Number(level) || 0) / 2)));
  }

  renderLevel(level = 0, { record = true } = {}) {
    const average = Math.min(255, Math.max(0, Number(level) || 0));
    this.lastLevel = average;
    if (record) this.recordLevel(average);

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.displayMode === 'gauge') {
      this.drawGauge(average);
      return;
    }
    if (this.displayMode === 'timeline') {
      this.drawTimeline(average);
      return;
    }

    this.drawCompact(average);
  }

  drawCompact(average) {

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

  drawGauge(level) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const compact = width < 240 || height < 100;
    const centerX = width / 2;
    const centerY = compact ? height * 0.58 : height * 0.5;
    const radius = Math.max(18, Math.min(width * 0.27, height * (compact ? 0.38 : 0.34)));
    const startAngle = Math.PI * 0.76;
    const sweep = Math.PI * 1.48;
    const lineWidth = Math.max(8, Math.min(22, radius * 0.34));
    const ratio = Math.min(1, level / 255);
    const warningThreshold = Math.max(40, this.tooLoudThreshold - 100);
    const zones = [
      { from: 0, to: warningThreshold / 255, color: '#22c55e' },
      { from: warningThreshold / 255, to: this.tooLoudThreshold / 255, color: '#fbbf24' },
      { from: this.tooLoudThreshold / 255, to: 1, color: '#fb4f5f' }
    ];

    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeStyle = 'rgba(226, 232, 240, 0.12)';
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, radius, startAngle, startAngle + sweep);
    this.ctx.stroke();

    const zoneGap = 0.012;
    zones.forEach((zone) => {
      const activeEndRatio = Math.min(zone.to, ratio);
      if (activeEndRatio <= zone.from) return;
      const inset = Math.min(zoneGap, (activeEndRatio - zone.from) / 3);
      this.ctx.strokeStyle = zone.color;
      this.ctx.shadowColor = zone.color;
      this.ctx.shadowBlur = level >= 150 ? 13 : 7;
      this.ctx.beginPath();
      this.ctx.arc(
        centerX,
        centerY,
        radius,
        startAngle + sweep * (zone.from + inset),
        startAngle + sweep * (activeEndRatio - inset)
      );
      this.ctx.stroke();
    });
    this.ctx.restore();

    const displayLevel = this.toDisplayLevel(level);
    this.ctx.save();
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#f8fafc';
    this.ctx.font = `800 ${Math.max(19, Math.min(38, radius * 0.76))}px system-ui, sans-serif`;
    this.ctx.fillText(String(displayLevel), centerX, centerY - (compact ? 0 : 2));

    if (!compact) {
      const stats = this.getRecentStats();
      const baseline = Math.min(height - 12, centerY + radius + lineWidth * 0.65);
      this.ctx.font = `700 ${Math.max(9, Math.min(13, width * 0.032))}px system-ui, sans-serif`;
      this.ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
      this.ctx.fillText(`PEAK ${this.toDisplayLevel(stats.peak)}`, centerX - radius * 0.72, baseline);
      this.ctx.fillText(`AVG ${this.toDisplayLevel(stats.average)}`, centerX + radius * 0.72, baseline);
    }
    this.ctx.restore();
  }

  drawTimeline(level) {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const compact = width < 260 || height < 100;
    const left = Math.max(8, width * 0.035);
    const right = Math.max(8, width * 0.035);
    const top = compact ? 8 : 22;
    const bottom = compact ? 8 : 16;
    const graphWidth = Math.max(1, width - left - right);
    const graphHeight = Math.max(1, height - top - bottom);
    const warningThreshold = Math.max(40, this.tooLoudThreshold - 100);
    const zones = [
      { from: 0, to: warningThreshold, color: 'rgba(34, 197, 94, 0.13)' },
      { from: warningThreshold, to: this.tooLoudThreshold, color: 'rgba(251, 191, 36, 0.14)' },
      { from: this.tooLoudThreshold, to: 255, color: 'rgba(251, 79, 95, 0.13)' }
    ];

    zones.forEach((zone) => {
      const yTop = top + graphHeight * (1 - zone.to / 255);
      const yBottom = top + graphHeight * (1 - zone.from / 255);
      this.ctx.fillStyle = zone.color;
      this.ctx.fillRect(left, yTop, graphWidth, yBottom - yTop);
    });

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(226, 232, 240, 0.14)';
    this.ctx.lineWidth = 1;
    [0.33, 0.66].forEach((ratio) => {
      const y = top + graphHeight * ratio;
      this.ctx.beginPath();
      this.ctx.moveTo(left, y);
      this.ctx.lineTo(left + graphWidth, y);
      this.ctx.stroke();
    });

    const now = Date.now();
    const samples = this.levelHistory.length
      ? this.levelHistory
      : [{ time: now, value: level }];
    const timelineStart = Math.max(now - this.historyWindowMs, samples[0].time);
    this.ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = left + graphWidth * Math.min(1, Math.max(0, (sample.time - timelineStart) / this.historyWindowMs));
      const y = top + graphHeight * (1 - Math.min(255, sample.value) / 255);
      if (index === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    });
    this.ctx.strokeStyle = '#f8fafc';
    this.ctx.lineWidth = Math.max(2, width * 0.006);
    this.ctx.shadowColor = '#60a5fa';
    this.ctx.shadowBlur = 8;
    this.ctx.stroke();
    this.ctx.restore();

    if (!compact) {
      const stats = this.getRecentStats();
      this.ctx.save();
      this.ctx.textBaseline = 'top';
      this.ctx.fillStyle = '#f8fafc';
      this.ctx.font = `800 ${Math.max(11, Math.min(16, width * 0.04))}px system-ui, sans-serif`;
      this.ctx.textAlign = 'left';
      this.ctx.fillText(`NOW ${this.toDisplayLevel(level)}`, left, 3);
      this.ctx.textAlign = 'right';
      this.ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
      this.ctx.fillText(`AVG ${this.toDisplayLevel(stats.average)} · 30 SEC`, width - right - 32, 3);
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
    this.cancelScheduledSample();
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
    this.renderLevel(0, { record: false });
  }

  destroy() {
    this.stop();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close();
    }
    this.audioContext = null;
  }
}
