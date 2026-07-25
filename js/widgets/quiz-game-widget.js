class QuizGameWidget {
    constructor() {
        this.layoutType = 'grid';
        const appModeUtils = window.TeacherScreenAppMode || {};
        this.isProjectorMode = appModeUtils.isProjectorMode || (() => (
            window.APP_MODE === 'projector'
            || document.body?.classList.contains('projector-view')
        ));

        const defaultQuiz = this.getDefaultQuizData();
        this.quizTitle = defaultQuiz.title;
        this.questions = defaultQuiz.questions;
        this.teams = defaultQuiz.teams.map((name) => ({ name, score: 0 }));
        this.quizFormat = defaultQuiz.quizFormat;
        this.responseMode = defaultQuiz.responseMode;
        this.showAnswers = defaultQuiz.showAnswers;
        this.showExplanations = defaultQuiz.showExplanations;
        this.currentQuestionIndex = 0;
        this.answerRevealed = false;
        this.questionTimerSeconds = 30;
        this.timerRemainingSeconds = this.questionTimerSeconds;
        this.timerRunning = false;
        this.timerInterval = null;
        this.questionBuzzTimeout = null;
        this.scoreBuzzTimeout = null;
        this.questionBuzzActive = false;
        this.lastScoreChange = null;

        this.handleLoadQuiz = this.handleLoadQuiz.bind(this);
        this.handleLoadSampleQuiz = this.handleLoadSampleQuiz.bind(this);
        this.handleImportLastRevealDeck = this.handleImportLastRevealDeck.bind(this);
        this.handleResetScores = this.handleResetScores.bind(this);
        this.handleTitleInput = this.handleTitleInput.bind(this);
        this.handleTeamNamesInput = this.handleTeamNamesInput.bind(this);
        this.handleTimerSecondsInput = this.handleTimerSecondsInput.bind(this);
        this.handleResponseModeInput = this.handleResponseModeInput.bind(this);
        this.handleDisplayOptionsInput = this.handleDisplayOptionsInput.bind(this);

        this.element = document.createElement('div');
        this.element.className = 'quiz-game-widget-content';
        this.element.classList.toggle('is-projector-mode', this.isProjectorMode());

        this.dragHandle = document.createElement('div');
        this.dragHandle.className = 'quiz-game-drag-handle';
        this.dragHandle.innerHTML = '<span class="quiz-game-drag-icon" aria-hidden="true">|||</span><span>Move</span>';
        this.dragHandle.setAttribute('role', 'presentation');

        this.header = document.createElement('div');
        this.header.className = 'quiz-game-header';

        this.headerMeta = document.createElement('div');
        this.headerMeta.className = 'quiz-game-header-meta';

        this.headerTitle = document.createElement('h3');
        this.headerTitle.className = 'quiz-game-title';

        this.headerProgress = document.createElement('div');
        this.headerProgress.className = 'quiz-game-progress';
        
        this.progressBarContainer = document.createElement('div');
        this.progressBarContainer.className = 'quiz-game-progress-bar-container';
        this.progressBar = document.createElement('div');
        this.progressBar.className = 'quiz-game-progress-bar';
        this.progressBarContainer.appendChild(this.progressBar);

        this.headerMeta.append(this.headerTitle, this.headerProgress, this.progressBarContainer);

        this.headerStatus = document.createElement('div');
        this.headerStatus.className = 'quiz-game-status-pill';

        this.headerAside = document.createElement('div');
        this.headerAside.className = 'quiz-game-header-aside';

        this.timerDisplay = document.createElement('div');
        this.timerDisplay.className = 'quiz-game-timer-display';

        this.timerLabel = document.createElement('div');
        this.timerLabel.className = 'quiz-game-timer-label';
        this.timerLabel.textContent = 'Timer';

        this.timerValue = document.createElement('div');
        this.timerValue.className = 'quiz-game-timer-value';

        this.timerDisplay.append(this.timerLabel, this.timerValue);
        this.headerAside.append(this.headerStatus, this.timerDisplay);
        this.header.append(this.headerMeta, this.headerAside);

        this.questionCard = document.createElement('div');
        this.questionCard.className = 'quiz-game-question-card';

        this.questionNumber = document.createElement('div');
        this.questionNumber.className = 'quiz-game-question-number';

        this.questionText = document.createElement('div');
        this.questionText.className = 'quiz-game-question-text';

        this.answersList = document.createElement('div');
        this.answersList.className = 'quiz-game-answers';

        this.answerPanel = document.createElement('div');
        this.answerPanel.className = 'quiz-game-direct-answer';

        this.answerPanelLabel = document.createElement('div');
        this.answerPanelLabel.className = 'quiz-game-direct-answer-label';

        this.answerPanelValue = document.createElement('div');
        this.answerPanelValue.className = 'quiz-game-direct-answer-value';

        this.answerPanel.append(this.answerPanelLabel, this.answerPanelValue);

        this.explanationPanel = document.createElement('div');
        this.explanationPanel.className = 'quiz-game-explanation';
        this.explanationPanel.hidden = true;
        this.explanationPanelLabel = document.createElement('strong');
        this.explanationPanelLabel.textContent = 'Why';
        this.explanationPanelValue = document.createElement('p');
        this.explanationPanel.append(this.explanationPanelLabel, this.explanationPanelValue);

        this.questionCard.append(this.questionNumber, this.questionText, this.answersList, this.answerPanel, this.explanationPanel);

        this.scoreboard = document.createElement('div');
        this.scoreboard.className = 'quiz-game-scoreboard';

        this.statusMessage = document.createElement('div');
        this.statusMessage.className = 'widget-status quiz-game-status';
        this.statusMessage.hidden = true;

        this.controlBar = document.createElement('div');
        this.controlBar.className = 'widget-control-bar quiz-game-control-bar';

        this.primaryActions = document.createElement('div');
        this.primaryActions.className = 'primary-actions';
        this.secondaryActions = document.createElement('div');
        this.secondaryActions.className = 'secondary-actions';

        this.prevButton = this.createControlButton('Prev', () => this.changeQuestion(-1), 'control-button control-button--ghost');
        this.revealButton = this.createControlButton('Reveal Answer', () => this.toggleAnswerReveal(), 'control-button');
        this.nextButton = this.createControlButton('Next', () => this.changeQuestion(1), 'control-button control-button--ghost');
        this.timerToggleButton = this.createControlButton('Start Timer', () => this.toggleTimer(), 'control-button control-button--ghost');
        this.timerResetButton = this.createControlButton('Reset Timer', () => this.resetTimer(), 'control-button control-button--ghost');
        this.primaryActions.append(this.prevButton, this.revealButton, this.nextButton);
        this.secondaryActions.append(this.timerToggleButton, this.timerResetButton);
        this.controlBar.append(this.primaryActions, this.secondaryActions);

        this.element.append(this.dragHandle, this.header, this.questionCard, this.scoreboard, this.statusMessage, this.controlBar);

        this.controlsOverlay = document.createElement('div');
        this.controlsOverlay.className = 'widget-content-controls quiz-game-settings-controls';

        this.titleLabel = document.createElement('label');
        this.titleLabel.textContent = 'Quiz title';
        this.titleInput = document.createElement('input');
        this.titleInput.type = 'text';
        this.titleInput.value = this.quizTitle;
        this.titleInput.addEventListener('input', this.handleTitleInput);
        this.titleLabel.appendChild(this.titleInput);

        this.teamNamesLabel = document.createElement('label');
        this.teamNamesLabel.textContent = 'Team names';
        this.teamNamesInput = document.createElement('input');
        this.teamNamesInput.type = 'text';
        this.teamNamesInput.value = this.teams.map((team) => team.name).join(', ');
        this.teamNamesInput.placeholder = 'Team 1, Team 2';
        this.teamNamesInput.addEventListener('change', this.handleTeamNamesInput);
        this.teamNamesLabel.appendChild(this.teamNamesInput);

        this.timerSecondsLabel = document.createElement('label');
        this.timerSecondsLabel.textContent = 'Question timer (seconds)';
        this.timerSecondsInput = document.createElement('input');
        this.timerSecondsInput.type = 'number';
        this.timerSecondsInput.min = '5';
        this.timerSecondsInput.max = '600';
        this.timerSecondsInput.step = '5';
        this.timerSecondsInput.value = String(this.questionTimerSeconds);
        this.timerSecondsInput.addEventListener('change', this.handleTimerSecondsInput);
        this.timerSecondsLabel.appendChild(this.timerSecondsInput);

        this.responseModeLabel = document.createElement('label');
        this.responseModeLabel.textContent = 'Response mode';
        this.responseModeInput = document.createElement('select');
        [
            ['whole-class', 'Whole class'],
            ['teams', 'Teams'],
            ['individual', 'Individual / mini whiteboards'],
            ['verbal', 'Verbal / hands up']
        ].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            this.responseModeInput.appendChild(option);
        });
        this.responseModeInput.value = this.responseMode;
        this.responseModeInput.addEventListener('change', this.handleResponseModeInput);
        this.responseModeLabel.appendChild(this.responseModeInput);

        this.displayOptions = document.createElement('div');
        this.displayOptions.className = 'quiz-game-display-options';
        this.showAnswersLabel = document.createElement('label');
        this.showAnswersInput = document.createElement('input');
        this.showAnswersInput.type = 'checkbox';
        this.showAnswersInput.checked = this.showAnswers;
        this.showAnswersInput.addEventListener('change', this.handleDisplayOptionsInput);
        this.showAnswersLabel.append(this.showAnswersInput, document.createTextNode(' Show answers'));
        this.showExplanationsLabel = document.createElement('label');
        this.showExplanationsInput = document.createElement('input');
        this.showExplanationsInput.type = 'checkbox';
        this.showExplanationsInput.checked = this.showExplanations;
        this.showExplanationsInput.addEventListener('change', this.handleDisplayOptionsInput);
        this.showExplanationsLabel.append(this.showExplanationsInput, document.createTextNode(' Show explanations'));
        this.displayOptions.append(this.showAnswersLabel, this.showExplanationsLabel);

        this.quizJsonLabel = document.createElement('label');
        this.quizJsonLabel.textContent = 'Quiz JSON';
        this.quizJsonInput = document.createElement('textarea');
        this.quizJsonInput.className = 'quiz-game-json-input';
        this.quizJsonInput.value = this.stringifyQuizData(defaultQuiz);
        this.quizJsonLabel.appendChild(this.quizJsonInput);

        this.settingsActions = document.createElement('div');
        this.settingsActions.className = 'button-group';

        this.loadQuizButton = this.createControlButton('Load Quiz', this.handleLoadQuiz);
        this.sampleQuizButton = this.createControlButton('Load Sample', this.handleLoadSampleQuiz, 'control-button control-button--ghost');
        this.importRevealButton = this.createControlButton('Import Last Reveal', this.handleImportLastRevealDeck, 'control-button control-button--ghost');
        this.resetScoresButton = this.createControlButton('Reset Scores', this.handleResetScores, 'control-button control-button--ghost');
        this.settingsActions.append(this.loadQuizButton, this.sampleQuizButton, this.importRevealButton, this.resetScoresButton);

        this.controlsOverlay.append(
            this.titleLabel,
            this.teamNamesLabel,
            this.timerSecondsLabel,
            this.responseModeLabel,
            this.displayOptions,
            this.quizJsonLabel,
            this.settingsActions
        );

        this.render();
    }

    createControlButton(label, onClick, className = 'control-button') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    getDefaultQuizData() {
        return {
            title: 'Quick Quiz',
            teams: ['Team 1', 'Team 2'],
            quizFormat: 'multiple-choice',
            responseMode: 'teams',
            showAnswers: true,
            showExplanations: false,
            questions: [
                {
                    type: 'multiple-choice',
                    question: 'Which planet is known as the Red Planet?',
                    choices: ['Earth', 'Mars', 'Jupiter', 'Venus'],
                    answer: 1,
                    answerText: 'Mars',
                    explanation: 'Iron minerals on the surface oxidise, giving Mars its reddish appearance.'
                },
                {
                    type: 'multiple-choice',
                    question: 'What is the largest ocean on Earth?',
                    choices: ['Atlantic Ocean', 'Indian Ocean', 'Pacific Ocean', 'Southern Ocean'],
                    answer: 2,
                    answerText: 'Pacific Ocean',
                    explanation: 'The Pacific covers more area than every other ocean.'
                },
                {
                    type: 'multiple-choice',
                    question: 'Which gas do plants absorb from the air?',
                    choices: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Helium'],
                    answer: 2,
                    answerText: 'Carbon Dioxide',
                    explanation: 'Plants use carbon dioxide during photosynthesis.'
                }
            ]
        };
    }

    stringifyQuizData(data) {
        return JSON.stringify(data, null, 2);
    }

    normalizeTeamNames(teamNames = []) {
        const normalized = teamNames
            .map((name) => String(name || '').trim())
            .filter(Boolean)
            .slice(0, 6);

        return normalized.length ? normalized : ['Team 1', 'Team 2'];
    }

    normalizeQuizData(data = {}, overrides = {}) {
        const validQuestionTypes = [
            'multiple-choice',
            'true-false',
            'short-answer',
            'matching',
            'ordering',
            'fill-in-the-blank',
            'rapid-fire',
            'jeopardy'
        ];
        const validQuizFormats = [...validQuestionTypes, 'team-quiz', 'mixed'];
        const requestedFormat = String(overrides.quizFormat || data.quizFormat || 'multiple-choice').trim();
        const quizFormat = validQuizFormats.includes(requestedFormat) ? requestedFormat : 'multiple-choice';
        const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
        const normalizedQuestions = rawQuestions.map((question) => {
            if (!question || typeof question !== 'object') {
                return null;
            }

            const prompt = String(question.question || question.prompt || question.text || '').trim();
            const requestedType = String(question.type || '').trim();
            let questionType = validQuestionTypes.includes(requestedType)
                ? requestedType
                : (validQuestionTypes.includes(quizFormat) ? quizFormat : 'multiple-choice');
            const choicesSource = Array.isArray(question.choices)
                ? question.choices
                : Array.isArray(question.options)
                    ? question.options
                    : Array.isArray(question.answers)
                        ? question.answers
                        : [];
            const choices = choicesSource
                .map((choice) => String(choice || '').trim())
                .filter(Boolean)
                .slice(0, 6);
            const explicitAnswerText = String(question.answerText || '').trim();
            const explanation = String(question.explanation || '').trim().slice(0, 1200);
            const category = String(question.category || '').trim().slice(0, 120);
            const points = Math.min(1000, Math.max(1, Number.parseInt(question.points, 10) || 1));
            const acceptedAnswers = Array.isArray(question.acceptedAnswers)
                ? question.acceptedAnswers.map((answer) => String(answer || '').trim()).filter(Boolean).slice(0, 12)
                : [];
            const pairs = Array.isArray(question.pairs)
                ? question.pairs.map((pair) => {
                    const left = String(pair?.left || '').trim();
                    const right = String(pair?.right || '').trim();
                    return left && right ? { left, right } : null;
                }).filter(Boolean).slice(0, 10)
                : [];
            const items = Array.isArray(question.items)
                ? question.items.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
                : [];

            if (!prompt) {
                return null;
            }

            let answerIndex = Number.isInteger(question.answer) ? question.answer : Number.parseInt(question.answer, 10);
            if (!Number.isInteger(answerIndex)) {
                answerIndex = Number.parseInt(question.answerIndex, 10);
            }
            if (!Number.isInteger(answerIndex) && typeof question.answer === 'string' && choices.length >= 2) {
                answerIndex = choices.findIndex((choice) => choice.toLowerCase() === question.answer.trim().toLowerCase());
            }

            if (questionType === 'true-false') {
                choices.splice(0, choices.length, 'True', 'False');
                if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 1) {
                    answerIndex = /^false$/i.test(explicitAnswerText) ? 1 : 0;
                }
            }

            if (questionType === 'matching' && pairs.length) {
                const matchingChoices = choices.length ? choices : pairs.map((pair) => pair.right).reverse();
                return {
                    type: questionType,
                    category,
                    points,
                    question: prompt,
                    choices: matchingChoices,
                    answer: 0,
                    answerText: explicitAnswerText || pairs.map((pair) => `${pair.left} → ${pair.right}`).join('; '),
                    acceptedAnswers,
                    pairs,
                    items: [],
                    explanation
                };
            }

            if (questionType === 'ordering' && items.length) {
                const orderingChoices = choices.length ? choices : [...items].reverse();
                return {
                    type: questionType,
                    category,
                    points,
                    question: prompt,
                    choices: orderingChoices,
                    answer: 0,
                    answerText: explicitAnswerText || items.map((item, index) => `${index + 1}. ${item}`).join(' '),
                    acceptedAnswers,
                    pairs: [],
                    items,
                    explanation
                };
            }

            if (choices.length >= 2 && !['short-answer', 'fill-in-the-blank'].includes(questionType)) {
                if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length) {
                    answerIndex = 0;
                }

                return {
                    type: questionType,
                    category,
                    points,
                    question: prompt,
                    choices,
                    answer: answerIndex,
                    answerText: explicitAnswerText || choices[answerIndex] || '',
                    acceptedAnswers,
                    pairs: [],
                    items: [],
                    explanation
                };
            }

            questionType = ['short-answer', 'fill-in-the-blank', 'rapid-fire', 'jeopardy'].includes(questionType)
                ? questionType
                : 'short-answer';
            const answerText = explicitAnswerText || acceptedAnswers[0] || String(question.answer || '').trim();
            if (!answerText) {
                return null;
            }

            return {
                type: questionType,
                category,
                points,
                question: prompt,
                choices: [],
                answer: 0,
                answerText,
                acceptedAnswers,
                pairs: [],
                items: [],
                explanation
            };
        }).filter(Boolean);

        if (!normalizedQuestions.length) {
            return null;
        }

        const teamNames = this.normalizeTeamNames(
            Array.isArray(overrides.teams) && overrides.teams.length
                ? overrides.teams
                : Array.isArray(data.teams)
                    ? data.teams
                    : []
        );

        const title = String(overrides.title || data.title || 'Quiz Game').trim() || 'Quiz Game';
        const responseModeCandidate = String(overrides.responseMode || data.responseMode || 'teams').trim();
        const responseMode = ['whole-class', 'teams', 'individual', 'verbal'].includes(responseModeCandidate)
            ? responseModeCandidate
            : 'teams';

        return {
            title,
            teams: teamNames,
            questions: normalizedQuestions,
            quizFormat,
            responseMode,
            showAnswers: overrides.showAnswers ?? data.showAnswers ?? true,
            showExplanations: overrides.showExplanations ?? data.showExplanations ?? false
        };
    }

    getTeamNamesFromInput() {
        return String(this.teamNamesInput?.value || '')
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean);
    }

    getCurrentQuestion() {
        return this.questions[this.currentQuestionIndex] || null;
    }

    getQuestionTypeLabel(type = '') {
        const labels = {
            'multiple-choice': 'Multiple choice',
            'true-false': 'True / false',
            'short-answer': 'Short answer',
            matching: 'Matching',
            ordering: 'Ordering',
            'fill-in-the-blank': 'Fill in the blank',
            'rapid-fire': 'Rapid-fire',
            jeopardy: 'Jeopardy'
        };
        return labels[type] || 'Question';
    }

    setStatus(message = '') {
        this.statusMessage.textContent = message;
        this.statusMessage.hidden = !String(message || '').trim();
    }

    formatTimer(seconds = 0) {
        const safeSeconds = Math.max(0, Number.parseInt(seconds, 10) || 0);
        const minutes = Math.floor(safeSeconds / 60);
        const remainder = safeSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    }

    clearTimerInterval() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    clearQuestionBuzzTimeout() {
        if (this.questionBuzzTimeout) {
            clearTimeout(this.questionBuzzTimeout);
            this.questionBuzzTimeout = null;
        }
    }

    clearScoreBuzzTimeout() {
        if (this.scoreBuzzTimeout) {
            clearTimeout(this.scoreBuzzTimeout);
            this.scoreBuzzTimeout = null;
        }
    }

    triggerQuestionBuzz() {
        this.clearQuestionBuzzTimeout();
        this.questionBuzzActive = true;
        this.render();
        this.questionBuzzTimeout = setTimeout(() => {
            this.questionBuzzTimeout = null;
            this.questionBuzzActive = false;
            this.render();
        }, 240);
    }

    triggerScoreBuzz(index, amount) {
        this.clearScoreBuzzTimeout();
        this.lastScoreChange = { index, amount };
        this.render();
        this.scoreBuzzTimeout = setTimeout(() => {
            this.scoreBuzzTimeout = null;
            this.lastScoreChange = null;
            this.render();
        }, 540);
    }

    resetTimer(emitChange = true) {
        this.clearTimerInterval();
        this.timerRunning = false;
        this.timerRemainingSeconds = this.questionTimerSeconds;
        this.render();
        if (emitChange) {
            this.setStatus('Question timer reset.');
            this.emitChange();
        }
    }

    toggleTimer() {
        if (this.timerRunning) {
            this.clearTimerInterval();
            this.timerRunning = false;
            this.render();
            this.setStatus('Question timer paused.');
            this.emitChange();
            return;
        }

        if (this.timerRemainingSeconds <= 0) {
            this.timerRemainingSeconds = this.questionTimerSeconds;
        }

        this.timerRunning = true;
        this.clearTimerInterval();
        this.timerInterval = setInterval(() => {
            if (this.timerRemainingSeconds <= 1) {
                this.clearTimerInterval();
                this.timerRunning = false;
                this.timerRemainingSeconds = 0;
                this.render();
                this.setStatus('Question timer finished.');
                this.triggerQuestionBuzz();
                this.emitChange();
                return;
            }

            this.timerRemainingSeconds -= 1;
            this.render();
            this.emitChange();
        }, 1000);

        this.render();
        this.emitChange();
    }

    emitChange() {
        document.dispatchEvent(new CustomEvent('widgetChanged', { detail: { widget: this } }));
    }

    updateResponsiveState(width = 0, height = 0) {
        const compact = width > 0 && (width < 1120 || height < 760);
        const tight = width > 0 && (width < 1040 || height < 720);
        this.element.classList.toggle('is-compact', compact);
        this.element.classList.toggle('is-tight', tight);
    }

    render() {
        const question = this.getCurrentQuestion();
        const totalQuestions = this.questions.length;
        const currentNumber = totalQuestions ? this.currentQuestionIndex + 1 : 0;

        this.element.classList.toggle('is-projector-mode', this.isProjectorMode());
        this.element.classList.toggle('has-revealed-answer', this.answerRevealed);
        this.element.classList.toggle('is-buzzing', this.questionBuzzActive);
        this.headerTitle.textContent = this.quizTitle || 'Quiz Game';
        this.headerProgress.textContent = totalQuestions ? `Question ${currentNumber} of ${totalQuestions}` : 'No questions';
        this.headerStatus.textContent = this.answerRevealed
            ? 'Revealed'
            : (question?.category || this.getQuestionTypeLabel(question?.type));

        const progressPercent = totalQuestions && totalQuestions > 0 ? ((this.currentQuestionIndex + 1) / totalQuestions) * 100 : 0;
        if (this.progressBar) {
            this.progressBar.style.width = `${progressPercent}%`;
        }

        this.timerValue.textContent = this.formatTimer(this.timerRemainingSeconds);
        this.timerDisplay.classList.toggle('is-running', this.timerRunning);
        this.timerDisplay.classList.toggle('is-finished', this.timerRemainingSeconds <= 0);
        const typeLabel = this.getQuestionTypeLabel(question?.type);
        const pointsLabel = question?.points > 1 ? ` • ${question.points} pts` : '';
        this.questionNumber.textContent = totalQuestions ? `Q${currentNumber} • ${typeLabel}${pointsLabel}` : 'Quiz';
        this.questionText.textContent = question ? question.question : 'Load a quiz to begin.';

        this.answersList.innerHTML = '';
        this.answerPanel.hidden = true;
        this.answerPanelLabel.textContent = '';
        this.answerPanelValue.textContent = '';
        this.explanationPanel.hidden = true;
        this.explanationPanelValue.textContent = '';
        if (question) {
            if (question.type === 'matching' && Array.isArray(question.pairs) && question.pairs.length) {
                question.pairs.forEach((pair, index) => {
                    const answer = document.createElement('div');
                    answer.className = 'quiz-game-answer';
                    answer.innerHTML = '<span class="quiz-game-answer-letter"></span><span class="quiz-game-answer-text"></span>';
                    answer.querySelector('.quiz-game-answer-letter').textContent = String(index + 1);
                    answer.querySelector('.quiz-game-answer-text').textContent = this.answerRevealed
                        ? `${pair.left} → ${pair.right}`
                        : `${pair.left} → ?`;
                    answer.classList.toggle('is-correct', this.answerRevealed);
                    this.answersList.appendChild(answer);
                });
                if (!this.answerRevealed && Array.isArray(question.choices) && question.choices.length) {
                    const bank = document.createElement('div');
                    bank.className = 'quiz-game-answer-bank';
                    bank.textContent = `Answer bank: ${question.choices.join(' • ')}`;
                    this.answersList.appendChild(bank);
                }
            } else if (question.type === 'ordering' && Array.isArray(question.items) && question.items.length) {
                const displayItems = this.answerRevealed ? question.items : question.choices;
                displayItems.forEach((item, index) => {
                    const answer = document.createElement('div');
                    answer.className = 'quiz-game-answer';
                    answer.innerHTML = '<span class="quiz-game-answer-letter"></span><span class="quiz-game-answer-text"></span>';
                    answer.querySelector('.quiz-game-answer-letter').textContent = this.answerRevealed ? String(index + 1) : '•';
                    answer.querySelector('.quiz-game-answer-text').textContent = item;
                    answer.classList.toggle('is-correct', this.answerRevealed);
                    this.answersList.appendChild(answer);
                });
            } else if (Array.isArray(question.choices) && question.choices.length >= 2) {
                question.choices.forEach((choice, index) => {
                    const answer = document.createElement('div');
                    answer.className = 'quiz-game-answer';
                    answer.innerHTML = '<span class="quiz-game-answer-letter"></span><span class="quiz-game-answer-text"></span>';
                    answer.querySelector('.quiz-game-answer-letter').textContent = String.fromCharCode(65 + index);
                    answer.querySelector('.quiz-game-answer-text').textContent = choice;

                    if (this.answerRevealed && this.showAnswers) {
                        answer.classList.add(index === question.answer ? 'is-correct' : 'is-dimmed');
                    }

                    this.answersList.appendChild(answer);
                });
            } else if (question.answerText) {
                this.answerPanel.hidden = false;
                this.answerPanel.classList.toggle('is-revealed', this.answerRevealed && this.showAnswers);
                this.answerPanelLabel.textContent = this.answerRevealed ? 'Correct answer' : 'Short answer';
                this.answerPanelValue.textContent = this.answerRevealed && this.showAnswers
                    ? question.answerText
                    : 'Reveal the answer to continue.';
            }

            if (this.answerRevealed && this.showExplanations && question.explanation) {
                this.explanationPanel.hidden = false;
                this.explanationPanelValue.textContent = question.explanation;
            }
        }

        this.scoreboard.innerHTML = '';
        this.scoreboard.hidden = this.responseMode !== 'teams' && this.quizFormat !== 'team-quiz';
        const maxScore = this.teams.length > 0 ? Math.max(...this.teams.map(t => t.score)) : 0;
        const hasLeader = maxScore > 0;

        this.teams.forEach((team, index) => {
            const card = document.createElement('div');
            card.className = 'quiz-game-team-card';
            
            if (hasLeader && team.score === maxScore) {
                card.classList.add('is-leader');
            }

            const scoreBuzz = this.lastScoreChange && this.lastScoreChange.index === index;
            if (scoreBuzz) {
                card.classList.add('is-score-buzzed');
            }

            const meta = document.createElement('div');
            meta.className = 'quiz-game-team-meta';

            const name = document.createElement('div');
            name.className = 'quiz-game-team-name';
            name.textContent = team.name;

            const score = document.createElement('div');
            score.className = 'quiz-game-team-score';
            score.textContent = String(team.score);

            meta.append(name, score);
            card.appendChild(meta);

            if (scoreBuzz) {
                const delta = document.createElement('div');
                delta.className = 'quiz-game-team-score-delta';
                delta.textContent = `${this.lastScoreChange.amount > 0 ? '+' : ''}${this.lastScoreChange.amount}`;
                card.appendChild(delta);
            }

            const actions = document.createElement('div');
            actions.className = 'quiz-game-score-actions';
            const scoreAmount = Math.max(1, Number.parseInt(question?.points, 10) || 1);
            actions.append(
                this.createControlButton(`-${scoreAmount}`, () => this.adjustScore(index, -scoreAmount), 'control-button control-button--ghost'),
                this.createControlButton(`+${scoreAmount}`, () => this.adjustScore(index, scoreAmount))
            );
            card.appendChild(actions);

            this.scoreboard.appendChild(card);
        });

        this.prevButton.disabled = this.currentQuestionIndex <= 0;
        this.nextButton.disabled = this.currentQuestionIndex >= totalQuestions - 1;
        this.revealButton.hidden = !this.showAnswers;
        this.revealButton.textContent = this.answerRevealed ? 'Hide Answer' : 'Reveal Answer';
        this.timerToggleButton.textContent = this.timerRunning ? 'Pause Timer' : 'Start Timer';
        this.titleInput.value = this.quizTitle;
        this.teamNamesInput.value = this.teams.map((team) => team.name).join(', ');
        this.timerSecondsInput.value = String(this.questionTimerSeconds);
        this.responseModeInput.value = this.responseMode;
        this.showAnswersInput.checked = this.showAnswers;
        this.showExplanationsInput.checked = this.showExplanations;
    }

    adjustScore(index, amount) {
        const team = this.teams[index];
        if (!team) {
            return;
        }

        team.score = Math.max(0, team.score + amount);
        this.render();
        this.setStatus(`${team.name} ${amount > 0 ? 'gains' : 'loses'} a point.`);
        this.triggerScoreBuzz(index, amount);
        this.emitChange();
    }

    changeQuestion(direction) {
        const nextIndex = Math.min(this.questions.length - 1, Math.max(0, this.currentQuestionIndex + direction));
        if (nextIndex === this.currentQuestionIndex) {
            return;
        }

        this.currentQuestionIndex = nextIndex;
        this.answerRevealed = false;
        this.lastScoreChange = null;
        this.resetTimer(false);
        this.render();
        this.setStatus(`Moved to question ${this.currentQuestionIndex + 1}.`);
        this.emitChange();
    }

    toggleAnswerReveal() {
        if (!this.showAnswers) {
            this.setStatus('Answer reveal is turned off for this quiz.');
            return;
        }
        this.answerRevealed = !this.answerRevealed;
        this.render();
        this.setStatus(this.answerRevealed ? 'Answer revealed.' : 'Answer hidden.');
        if (this.answerRevealed) {
            this.triggerQuestionBuzz();
        }
        this.emitChange();
    }

    hideAnswer() {
        if (!this.answerRevealed) {
            return;
        }

        this.answerRevealed = false;
        this.render();
        this.setStatus('Answer hidden.');
        this.emitChange();
    }

    handleTitleInput() {
        const nextTitle = String(this.titleInput.value || '').trim();
        this.quizTitle = nextTitle || 'Quiz Game';
        this.render();
        this.emitChange();
    }

    handleTeamNamesInput() {
        const nextNames = this.normalizeTeamNames(this.getTeamNamesFromInput());
        const previousScores = new Map(this.teams.map((team) => [team.name, team.score]));
        this.teams = nextNames.map((name) => ({
            name,
            score: previousScores.get(name) || 0
        }));
        this.render();
        this.setStatus('Team names updated.');
        this.emitChange();
    }

    handleTimerSecondsInput() {
        const nextSeconds = Math.min(600, Math.max(5, Number.parseInt(this.timerSecondsInput.value, 10) || this.questionTimerSeconds));
        this.questionTimerSeconds = nextSeconds;
        this.resetTimer(false);
        this.render();
        this.setStatus('Question timer updated.');
        this.emitChange();
    }

    handleResponseModeInput() {
        this.responseMode = this.responseModeInput.value || 'teams';
        this.render();
        this.setStatus('Response mode updated.');
        this.emitChange();
    }

    handleDisplayOptionsInput() {
        this.showAnswers = this.showAnswersInput.checked;
        this.showExplanations = this.showExplanationsInput.checked;
        if (!this.showAnswers) {
            this.answerRevealed = false;
        }
        this.render();
        this.setStatus('Answer display options updated.');
        this.emitChange();
    }

    handleLoadQuiz() {
        let parsed;
        try {
            parsed = JSON.parse(this.quizJsonInput.value);
        } catch (error) {
            this.setStatus('Quiz JSON could not be parsed.');
            return;
        }

        const normalized = this.normalizeQuizData(parsed, {
            title: this.titleInput.value,
            teams: this.getTeamNamesFromInput(),
            responseMode: this.responseModeInput.value,
            showAnswers: this.showAnswersInput.checked,
            showExplanations: this.showExplanationsInput.checked
        });

        if (!normalized) {
            this.setStatus('Quiz JSON needs questions with choices or short-answer text.');
            return;
        }

        this.quizTitle = normalized.title;
        this.questions = normalized.questions;
        this.teams = normalized.teams.map((name) => ({ name, score: 0 }));
        this.quizFormat = normalized.quizFormat;
        this.responseMode = normalized.responseMode;
        this.showAnswers = normalized.showAnswers;
        this.showExplanations = normalized.showExplanations;
        this.currentQuestionIndex = 0;
        this.answerRevealed = false;
        this.resetTimer(false);
        this.quizJsonInput.value = this.stringifyQuizData({
            title: this.quizTitle,
            teams: this.teams.map((team) => team.name),
            quizFormat: this.quizFormat,
            responseMode: this.responseMode,
            showAnswers: this.showAnswers,
            showExplanations: this.showExplanations,
            questions: this.questions
        });
        this.render();
        this.setStatus(`Loaded ${this.questions.length} quiz questions.`);
        this.emitChange();
    }

    handleLoadSampleQuiz() {
        const sampleQuiz = this.getDefaultQuizData();
        this.quizJsonInput.value = this.stringifyQuizData(sampleQuiz);
        this.titleInput.value = sampleQuiz.title;
        this.teamNamesInput.value = sampleQuiz.teams.join(', ');
        this.responseModeInput.value = sampleQuiz.responseMode;
        this.showAnswersInput.checked = sampleQuiz.showAnswers;
        this.showExplanationsInput.checked = sampleQuiz.showExplanations;
        this.handleLoadQuiz();
    }

    getLastRevealDeck() {
        try {
            const parsed = JSON.parse(localStorage.getItem('revealLastDeck') || 'null');
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }

            if (parsed.type !== 'html' || typeof parsed.content !== 'string' || !parsed.content.trim()) {
                return null;
            }

            return parsed;
        } catch (error) {
            return null;
        }
    }

    getRevealLeafSections(doc) {
        const topSections = Array.from(doc.querySelectorAll('.slides > section'));
        return topSections.flatMap((section) => {
            const childSections = Array.from(section.children).filter((child) => child.tagName === 'SECTION');
            return childSections.length ? childSections : [section];
        });
    }

    parseRevealQuestionNumber(text = '') {
        const match = String(text || '').match(/(\d+)/);
        return match ? Number.parseInt(match[1], 10) : null;
    }

    importRevealQuizDeck(deck = {}) {
        if (typeof deck.content !== 'string' || !deck.content.trim()) {
            return null;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(deck.content, 'text/html');
        const sections = this.getRevealLeafSections(doc);
        const questionsByNumber = new Map();
        const answerMap = new Map();
        let fallbackQuestionNumber = 1;

        sections.forEach((section) => {
            const questionShell = section.querySelector('.question-shell');
            if (questionShell) {
                const questionNumber = this.parseRevealQuestionNumber(
                    questionShell.querySelector('.q-number')?.textContent || ''
                ) || fallbackQuestionNumber++;
                const questionText = String(
                    questionShell.querySelector('.question-card h1, .question-card h2, .question-card h3')?.textContent || ''
                ).trim();
                if (questionText) {
                    questionsByNumber.set(questionNumber, {
                        number: questionNumber,
                        question: questionText,
                        choices: [],
                        answer: 0,
                        answerText: ''
                    });
                }
                return;
            }

            const answerItems = Array.from(section.querySelectorAll('.answers-shell .answer-item'));
            if (!answerItems.length) {
                return;
            }

            answerItems.forEach((item) => {
                const text = String(item.textContent || '').trim();
                const match = text.match(/^(\d+)[.)]?\s*(.+)$/);
                if (!match) {
                    return;
                }
                answerMap.set(Number.parseInt(match[1], 10), match[2].trim());
            });
        });

        const questions = Array.from(questionsByNumber.values())
            .sort((a, b) => a.number - b.number)
            .map((question) => ({
                question: question.question,
                choices: [],
                answer: 0,
                answerText: answerMap.get(question.number) || ''
            }))
            .filter((question) => question.question && question.answerText);

        if (!questions.length) {
            return null;
        }

        return {
            title: String(deck.name || doc.querySelector('title')?.textContent || 'Imported Reveal Quiz').trim(),
            teams: this.getTeamNamesFromInput(),
            questions
        };
    }

    handleImportLastRevealDeck() {
        const deck = this.getLastRevealDeck();
        if (!deck) {
            this.setStatus('Open a Reveal HTML quiz first, then import it here.');
            return;
        }

        const importedQuiz = this.importRevealQuizDeck(deck);
        if (!importedQuiz) {
            this.setStatus('That Reveal deck did not match the quiz importer yet.');
            return;
        }

        this.titleInput.value = importedQuiz.title;
        this.teamNamesInput.value = (importedQuiz.teams && importedQuiz.teams.length
            ? importedQuiz.teams
            : this.teams.map((team) => team.name)).join(', ');
        this.quizJsonInput.value = this.stringifyQuizData(importedQuiz);
        this.handleLoadQuiz();
        this.setStatus(`Imported ${importedQuiz.questions.length} questions from the last Reveal deck.`);
    }

    handleResetScores() {
        this.teams = this.teams.map((team) => ({ ...team, score: 0 }));
        this.render();
        this.setStatus('Scores reset.');
        this.emitChange();
    }

    getControls() {
        return this.controlsOverlay;
    }

    onWidgetLayout({ width = 0, height = 0 } = {}) {
        this.updateResponsiveState(width, height);
    }

    serialize() {
        return {
            type: 'QuizGameWidget',
            title: this.quizTitle,
            teams: this.teams,
            questions: this.questions,
            quizFormat: this.quizFormat,
            responseMode: this.responseMode,
            showAnswers: this.showAnswers,
            showExplanations: this.showExplanations,
            currentQuestionIndex: this.currentQuestionIndex,
            answerRevealed: this.answerRevealed,
            questionTimerSeconds: this.questionTimerSeconds,
            timerRemainingSeconds: this.timerRemainingSeconds,
            timerRunning: false
        };
    }

    deserialize(data = {}) {
        const normalized = this.normalizeQuizData({
            title: data.title,
            teams: Array.isArray(data.teams) ? data.teams.map((team) => team?.name || team) : [],
            questions: Array.isArray(data.questions) ? data.questions : [],
            quizFormat: data.quizFormat,
            responseMode: data.responseMode,
            showAnswers: data.showAnswers,
            showExplanations: data.showExplanations
        });

        if (!normalized) {
            return;
        }

        const scores = Array.isArray(data.teams) ? data.teams : [];
        this.quizTitle = normalized.title;
        this.questions = normalized.questions;
        this.quizFormat = normalized.quizFormat;
        this.responseMode = normalized.responseMode;
        this.showAnswers = normalized.showAnswers;
        this.showExplanations = normalized.showExplanations;
        this.teams = normalized.teams.map((name, index) => ({
            name,
            score: Math.max(0, Number.parseInt(scores[index]?.score, 10) || 0)
        }));
        this.currentQuestionIndex = Math.min(
            Math.max(0, Number.parseInt(data.currentQuestionIndex, 10) || 0),
            Math.max(0, this.questions.length - 1)
        );
        this.answerRevealed = this.showAnswers && !!data.answerRevealed;
        this.questionTimerSeconds = Math.min(600, Math.max(5, Number.parseInt(data.questionTimerSeconds, 10) || 30));
        this.timerRemainingSeconds = Math.min(
            this.questionTimerSeconds,
            Math.max(0, Number.parseInt(data.timerRemainingSeconds, 10) || this.questionTimerSeconds)
        );
        this.timerRunning = false;
        this.clearTimerInterval();
        this.questionBuzzActive = false;
        this.lastScoreChange = null;
        this.quizJsonInput.value = this.stringifyQuizData({
            title: this.quizTitle,
            teams: this.teams.map((team) => team.name),
            quizFormat: this.quizFormat,
            responseMode: this.responseMode,
            showAnswers: this.showAnswers,
            showExplanations: this.showExplanations,
            questions: this.questions
        });
        this.render();
    }

    remove() {
        this.clearTimerInterval();
        this.clearQuestionBuzzTimeout();
        this.clearScoreBuzzTimeout();
        this.titleInput.removeEventListener('input', this.handleTitleInput);
        this.teamNamesInput.removeEventListener('change', this.handleTeamNamesInput);
        this.timerSecondsInput.removeEventListener('change', this.handleTimerSecondsInput);
        this.responseModeInput.removeEventListener('change', this.handleResponseModeInput);
        this.showAnswersInput.removeEventListener('change', this.handleDisplayOptionsInput);
        this.showExplanationsInput.removeEventListener('change', this.handleDisplayOptionsInput);
        this.loadQuizButton.removeEventListener('click', this.handleLoadQuiz);
        this.sampleQuizButton.removeEventListener('click', this.handleLoadSampleQuiz);
        this.importRevealButton.removeEventListener('click', this.handleImportLastRevealDeck);
        this.resetScoresButton.removeEventListener('click', this.handleResetScores);
        this.element.remove();
        document.dispatchEvent(new CustomEvent('widgetRemoved', { detail: { widget: this } }));
    }
}
