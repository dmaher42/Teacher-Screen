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
        this.currentQuestionIndex = 0;
        this.answerRevealed = false;

        this.handleLoadQuiz = this.handleLoadQuiz.bind(this);
        this.handleLoadSampleQuiz = this.handleLoadSampleQuiz.bind(this);
        this.handleResetScores = this.handleResetScores.bind(this);
        this.handleTitleInput = this.handleTitleInput.bind(this);
        this.handleTeamNamesInput = this.handleTeamNamesInput.bind(this);

        this.element = document.createElement('div');
        this.element.className = 'quiz-game-widget-content';
        this.element.classList.toggle('is-projector-mode', this.isProjectorMode());

        this.dragHandle = document.createElement('div');
        this.dragHandle.className = 'quiz-game-drag-handle';
        this.dragHandle.textContent = 'Move';
        this.dragHandle.setAttribute('role', 'presentation');

        this.header = document.createElement('div');
        this.header.className = 'quiz-game-header';

        this.headerMeta = document.createElement('div');
        this.headerMeta.className = 'quiz-game-header-meta';

        this.headerTitle = document.createElement('h3');
        this.headerTitle.className = 'quiz-game-title';

        this.headerProgress = document.createElement('div');
        this.headerProgress.className = 'quiz-game-progress';
        this.headerMeta.append(this.headerTitle, this.headerProgress);

        this.headerStatus = document.createElement('div');
        this.headerStatus.className = 'quiz-game-status-pill';
        this.header.append(this.headerMeta, this.headerStatus);

        this.questionCard = document.createElement('div');
        this.questionCard.className = 'quiz-game-question-card';

        this.questionNumber = document.createElement('div');
        this.questionNumber.className = 'quiz-game-question-number';

        this.questionText = document.createElement('div');
        this.questionText.className = 'quiz-game-question-text';

        this.answersList = document.createElement('div');
        this.answersList.className = 'quiz-game-answers';

        this.questionCard.append(this.questionNumber, this.questionText, this.answersList);

        this.scoreboard = document.createElement('div');
        this.scoreboard.className = 'quiz-game-scoreboard';

        this.statusMessage = document.createElement('div');
        this.statusMessage.className = 'widget-status quiz-game-status';

        this.controlBar = document.createElement('div');
        this.controlBar.className = 'widget-control-bar quiz-game-control-bar';

        this.primaryActions = document.createElement('div');
        this.primaryActions.className = 'primary-actions';

        this.prevButton = this.createControlButton('Prev', () => this.changeQuestion(-1), 'control-button control-button--ghost');
        this.revealButton = this.createControlButton('Reveal Answer', () => this.toggleAnswerReveal(), 'control-button');
        this.nextButton = this.createControlButton('Next', () => this.changeQuestion(1), 'control-button control-button--ghost');
        this.primaryActions.append(this.prevButton, this.revealButton, this.nextButton);
        this.controlBar.appendChild(this.primaryActions);

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
        this.resetScoresButton = this.createControlButton('Reset Scores', this.handleResetScores, 'control-button control-button--ghost');
        this.settingsActions.append(this.loadQuizButton, this.sampleQuizButton, this.resetScoresButton);

        this.controlsOverlay.append(this.titleLabel, this.teamNamesLabel, this.quizJsonLabel, this.settingsActions);

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
            questions: [
                {
                    question: 'Which planet is known as the Red Planet?',
                    choices: ['Earth', 'Mars', 'Jupiter', 'Venus'],
                    answer: 1
                },
                {
                    question: 'What is the largest ocean on Earth?',
                    choices: ['Atlantic Ocean', 'Indian Ocean', 'Pacific Ocean', 'Southern Ocean'],
                    answer: 2
                },
                {
                    question: 'Which gas do plants absorb from the air?',
                    choices: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Helium'],
                    answer: 2
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
        const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
        const normalizedQuestions = rawQuestions.map((question) => {
            if (!question || typeof question !== 'object') {
                return null;
            }

            const prompt = String(question.question || question.prompt || question.text || '').trim();
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

            if (!prompt || choices.length < 2) {
                return null;
            }

            let answerIndex = Number.isInteger(question.answer) ? question.answer : Number.parseInt(question.answer, 10);
            if (!Number.isInteger(answerIndex) && typeof question.answer === 'string') {
                answerIndex = choices.findIndex((choice) => choice.toLowerCase() === question.answer.trim().toLowerCase());
            }

            if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length) {
                answerIndex = 0;
            }

            return {
                question: prompt,
                choices,
                answer: answerIndex
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

        return {
            title,
            teams: teamNames,
            questions: normalizedQuestions
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

    setStatus(message = '') {
        this.statusMessage.textContent = message;
    }

    emitChange() {
        document.dispatchEvent(new CustomEvent('widgetChanged', { detail: { widget: this } }));
    }

    render() {
        const question = this.getCurrentQuestion();
        const totalQuestions = this.questions.length;
        const currentNumber = totalQuestions ? this.currentQuestionIndex + 1 : 0;

        this.element.classList.toggle('has-revealed-answer', this.answerRevealed);
        this.headerTitle.textContent = this.quizTitle || 'Quiz Game';
        this.headerProgress.textContent = totalQuestions ? `Question ${currentNumber} of ${totalQuestions}` : 'No questions';
        this.headerStatus.textContent = this.answerRevealed ? 'Answer Revealed' : 'Question Live';
        this.questionNumber.textContent = totalQuestions ? `Q${currentNumber}` : 'Quiz';
        this.questionText.textContent = question ? question.question : 'Load a quiz to begin.';

        this.answersList.innerHTML = '';
        if (question) {
            question.choices.forEach((choice, index) => {
                const answer = document.createElement('div');
                answer.className = 'quiz-game-answer';
                answer.innerHTML = '<span class="quiz-game-answer-letter"></span><span class="quiz-game-answer-text"></span>';
                answer.querySelector('.quiz-game-answer-letter').textContent = String.fromCharCode(65 + index);
                answer.querySelector('.quiz-game-answer-text').textContent = choice;

                if (this.answerRevealed) {
                    answer.classList.add(index === question.answer ? 'is-correct' : 'is-dimmed');
                }

                this.answersList.appendChild(answer);
            });
        }

        this.scoreboard.innerHTML = '';
        this.teams.forEach((team, index) => {
            const card = document.createElement('div');
            card.className = 'quiz-game-team-card';

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

            const actions = document.createElement('div');
            actions.className = 'quiz-game-score-actions';
            actions.append(
                this.createControlButton('-1', () => this.adjustScore(index, -1), 'control-button control-button--ghost'),
                this.createControlButton('+1', () => this.adjustScore(index, 1))
            );
            card.appendChild(actions);

            this.scoreboard.appendChild(card);
        });

        this.prevButton.disabled = this.currentQuestionIndex <= 0;
        this.nextButton.disabled = this.currentQuestionIndex >= totalQuestions - 1;
        this.revealButton.textContent = this.answerRevealed ? 'Hide Answer' : 'Reveal Answer';
        this.titleInput.value = this.quizTitle;
        this.teamNamesInput.value = this.teams.map((team) => team.name).join(', ');
    }

    adjustScore(index, amount) {
        const team = this.teams[index];
        if (!team) {
            return;
        }

        team.score = Math.max(0, team.score + amount);
        this.render();
        this.setStatus(`${team.name} ${amount > 0 ? 'gains' : 'loses'} a point.`);
        this.emitChange();
    }

    changeQuestion(direction) {
        const nextIndex = Math.min(this.questions.length - 1, Math.max(0, this.currentQuestionIndex + direction));
        if (nextIndex === this.currentQuestionIndex) {
            return;
        }

        this.currentQuestionIndex = nextIndex;
        this.answerRevealed = false;
        this.render();
        this.setStatus(`Moved to question ${this.currentQuestionIndex + 1}.`);
        this.emitChange();
    }

    toggleAnswerReveal() {
        this.answerRevealed = !this.answerRevealed;
        this.render();
        this.setStatus(this.answerRevealed ? 'Answer revealed.' : 'Answer hidden.');
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
            teams: this.getTeamNamesFromInput()
        });

        if (!normalized) {
            this.setStatus('Quiz JSON needs questions with at least two choices.');
            return;
        }

        this.quizTitle = normalized.title;
        this.questions = normalized.questions;
        this.teams = normalized.teams.map((name) => ({ name, score: 0 }));
        this.currentQuestionIndex = 0;
        this.answerRevealed = false;
        this.quizJsonInput.value = this.stringifyQuizData({
            title: this.quizTitle,
            teams: this.teams.map((team) => team.name),
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
        this.handleLoadQuiz();
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

    serialize() {
        return {
            type: 'QuizGameWidget',
            title: this.quizTitle,
            teams: this.teams,
            questions: this.questions,
            currentQuestionIndex: this.currentQuestionIndex,
            answerRevealed: this.answerRevealed
        };
    }

    deserialize(data = {}) {
        const normalized = this.normalizeQuizData({
            title: data.title,
            teams: Array.isArray(data.teams) ? data.teams.map((team) => team?.name || team) : [],
            questions: Array.isArray(data.questions) ? data.questions : []
        });

        if (!normalized) {
            return;
        }

        const scores = Array.isArray(data.teams) ? data.teams : [];
        this.quizTitle = normalized.title;
        this.questions = normalized.questions;
        this.teams = normalized.teams.map((name, index) => ({
            name,
            score: Math.max(0, Number.parseInt(scores[index]?.score, 10) || 0)
        }));
        this.currentQuestionIndex = Math.min(
            Math.max(0, Number.parseInt(data.currentQuestionIndex, 10) || 0),
            Math.max(0, this.questions.length - 1)
        );
        this.answerRevealed = !!data.answerRevealed;
        this.quizJsonInput.value = this.stringifyQuizData({
            title: this.quizTitle,
            teams: this.teams.map((team) => team.name),
            questions: this.questions
        });
        this.render();
    }

    remove() {
        this.titleInput.removeEventListener('input', this.handleTitleInput);
        this.teamNamesInput.removeEventListener('change', this.handleTeamNamesInput);
        this.loadQuizButton.removeEventListener('click', this.handleLoadQuiz);
        this.sampleQuizButton.removeEventListener('click', this.handleLoadSampleQuiz);
        this.resetScoresButton.removeEventListener('click', this.handleResetScores);
        this.element.remove();
        document.dispatchEvent(new CustomEvent('widgetRemoved', { detail: { widget: this } }));
    }
}
