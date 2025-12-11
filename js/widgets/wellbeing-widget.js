class WellbeingWidget {
    constructor() {
        this.currentMode = 'student';
        this.counts = {
            great: 0,
            good: 0,
            meh: 0,
            worried: 0,
            sad: 0,
        };
        this.historyKey = 'wellbeingHistory';
        this.chart = null;

        this.element = document.createElement('div');
        this.element.className = 'wellbeing-widget-content';

        this.buildHeader();
        this.buildModes();
        this.updateMode();
    }

    buildHeader() {
        this.header = document.createElement('div');
        this.header.className = 'wellbeing-header secondary-control';

        const title = document.createElement('div');
        title.className = 'wellbeing-title';
        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.textContent = '💖';
        const text = document.createElement('span');
        text.textContent = 'Well-being';
        title.appendChild(icon);
        title.appendChild(text);

        this.toggleBtn = document.createElement('button');
        this.toggleBtn.className = 'wellbeing-toggle-btn';
        this.toggleBtn.type = 'button';
        this.toggleBtn.textContent = 'Switch to Teacher Dashboard';
        this.toggleBtn.addEventListener('click', () => this.toggleMode());

        this.header.appendChild(title);
        this.header.appendChild(this.toggleBtn);
        this.element.appendChild(this.header);
    }

    buildModes() {
        this.modesContainer = document.createElement('div');
        this.modesContainer.className = 'wellbeing-modes';

        this.studentMode = document.createElement('div');
        this.studentMode.className = 'wellbeing-mode wellbeing-student-mode';

        const prompt = document.createElement('div');
        prompt.className = 'wellbeing-prompt';
        prompt.textContent = 'How are you feeling today?';
        this.studentMode.appendChild(prompt);

        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'wellbeing-options';

        const options = [
            { key: 'great', label: 'Great', emoji: '😄' },
            { key: 'good', label: 'Good', emoji: '🙂' },
            { key: 'meh', label: 'Meh', emoji: '😐' },
            { key: 'worried', label: 'Worried', emoji: '😔' },
            { key: 'sad', label: 'Sad', emoji: '😞' },
        ];

        options.forEach((option) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wellbeing-option';
            button.dataset.key = option.key;

            const emojiSpan = document.createElement('span');
            emojiSpan.className = 'emoji';
            emojiSpan.textContent = option.emoji;

            const textSpan = document.createElement('span');
            textSpan.textContent = option.label;

            button.appendChild(emojiSpan);
            button.appendChild(textSpan);

            button.addEventListener('click', () => this.handleStudentInput(option.key, button));

            optionsContainer.appendChild(button);
        });

        this.studentMode.appendChild(optionsContainer);

        this.dashboardMode = document.createElement('div');
        this.dashboardMode.className = 'wellbeing-mode wellbeing-dashboard-mode';

        const dashHeader = document.createElement('div');
        dashHeader.className = 'wellbeing-dashboard-header';
        const dashTitle = document.createElement('h3');
        dashTitle.textContent = "Today's Results";
        dashHeader.appendChild(dashTitle);
        this.dashboardMode.appendChild(dashHeader);

        const chartContainer = document.createElement('div');
        chartContainer.className = 'wellbeing-chart-container';
        this.chartCanvas = document.createElement('canvas');
        this.chartCanvas.id = `wellbeing-chart-${Date.now()}`;
        chartContainer.appendChild(this.chartCanvas);
        this.dashboardMode.appendChild(chartContainer);

        const actions = document.createElement('div');
        actions.className = 'wellbeing-dashboard-actions secondary-control';

        this.saveBtn = document.createElement('button');
        this.saveBtn.type = 'button';
        this.saveBtn.textContent = "Save Today's Check-in";
        this.saveBtn.addEventListener('click', () => this.saveCurrentCounts());

        this.historyBtn = document.createElement('button');
        this.historyBtn.type = 'button';
        this.historyBtn.textContent = 'View History';
        this.historyBtn.addEventListener('click', () => this.showHistory());

        actions.appendChild(this.saveBtn);
        actions.appendChild(this.historyBtn);
        this.dashboardMode.appendChild(actions);

        this.status = document.createElement('div');
        this.status.className = 'wellbeing-status secondary-text';
        this.status.textContent = 'Ready for check-ins.';
        this.dashboardMode.appendChild(this.status);

        this.modesContainer.appendChild(this.studentMode);
        this.modesContainer.appendChild(this.dashboardMode);
        this.element.appendChild(this.modesContainer);
    }

    toggleMode() {
        this.currentMode = this.currentMode === 'student' ? 'dashboard' : 'student';
        this.updateMode();
    }

    updateMode() {
        if (this.currentMode === 'student') {
            this.studentMode.classList.add('active');
            this.dashboardMode.classList.remove('active');
            this.toggleBtn.textContent = 'Switch to Teacher Dashboard';
        } else {
            this.studentMode.classList.remove('active');
            this.dashboardMode.classList.add('active');
            this.toggleBtn.textContent = 'Switch to Student Input';
            this.renderChart();
        }
    }

    handleStudentInput(key, button) {
        if (!this.counts[key] && this.counts[key] !== 0) return;
        this.counts[key] += 1;
        button.classList.add('is-active');
        setTimeout(() => {
            button.classList.remove('is-active');
        }, 350);

        if (this.currentMode === 'dashboard') {
            this.renderChart();
        }
    }

    renderChart() {
        if (!this.chartCanvas || typeof Chart === 'undefined') {
            return;
        }

        const labels = ['Great', 'Good', 'Meh', 'Worried', 'Sad'];
        const data = [
            this.counts.great,
            this.counts.good,
            this.counts.meh,
            this.counts.worried,
            this.counts.sad,
        ];

        const dataset = {
            label: 'Responses',
            data,
            backgroundColor: ['#22c55e', '#84cc16', '#fbbf24', '#60a5fa', '#f87171'],
            borderRadius: 6,
        };

        if (this.chart) {
            this.chart.data.datasets[0].data = dataset.data;
            this.chart.update();
            return;
        }

        const ctx = this.chartCanvas.getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [dataset],
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0,
                        },
                    },
                },
            },
        });
    }

    saveCurrentCounts() {
        try {
            const history = this.getHistory();
            const entry = {
                timestamp: new Date().toISOString(),
                counts: { ...this.counts },
            };
            history.push(entry);
            localStorage.setItem(this.historyKey, JSON.stringify(history));
            this.status.textContent = 'Saved today\'s check-in.';
        } catch (error) {
            console.warn('Failed to save well-being history', error);
            this.status.textContent = 'Could not save right now.';
        }
    }

    getHistory() {
        try {
            const raw = localStorage.getItem(this.historyKey);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Failed to parse well-being history', error);
            return [];
        }
    }

    showHistory() {
        if (!this.historyDialog) {
            this.historyDialog = document.createElement('dialog');
            this.historyDialog.className = 'wellbeing-history-dialog';

            const title = document.createElement('h4');
            title.textContent = 'Well-being History';
            this.historyDialog.appendChild(title);

            this.historyList = document.createElement('ul');
            this.historyList.className = 'wellbeing-history-list';
            this.historyDialog.appendChild(this.historyList);

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.textContent = 'Close';
            closeBtn.addEventListener('click', () => this.historyDialog.close());
            this.historyDialog.appendChild(closeBtn);

            document.body.appendChild(this.historyDialog);
        }

        this.renderHistoryList();

        if (typeof this.historyDialog.showModal === 'function') {
            this.historyDialog.showModal();
        } else {
            this.historyDialog.open = true;
        }
    }

    renderHistoryList() {
        if (!this.historyList) return;
        this.historyList.innerHTML = '';
        const history = this.getHistory();
        if (!history.length) {
            const empty = document.createElement('li');
            empty.textContent = 'No history saved yet.';
            this.historyList.appendChild(empty);
            return;
        }

        history.slice().reverse().forEach((entry) => {
            const item = document.createElement('li');
            item.className = 'wellbeing-history-item';
            const timestamp = new Date(entry.timestamp);
            const heading = document.createElement('strong');
            heading.textContent = timestamp.toLocaleString();
            item.appendChild(heading);

            const details = document.createElement('div');
            details.textContent = `Great: ${entry.counts.great || 0}, Good: ${entry.counts.good || 0}, Meh: ${entry.counts.meh || 0}, Worried: ${entry.counts.worried || 0}, Sad: ${entry.counts.sad || 0}`;
            item.appendChild(details);

            this.historyList.appendChild(item);
        });
    }

    serialize() {
        return {
            currentMode: this.currentMode,
            counts: { ...this.counts },
        };
    }

    deserialize(data = {}) {
        if (data.counts) {
            this.counts = { ...this.counts, ...data.counts };
        }
        if (data.currentMode) {
            this.currentMode = data.currentMode;
        }
        this.updateMode();
        if (this.currentMode === 'dashboard') {
            this.renderChart();
        }
    }
}
