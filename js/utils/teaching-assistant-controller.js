import { TeachingAssistantService } from '../services/teaching-assistant-service.js';

const QUIZ_TYPE_LABELS = {
    'multiple-choice': 'Multiple choice',
    'true-false': 'True / false',
    'short-answer': 'Short answer',
    matching: 'Matching',
    ordering: 'Ordering',
    'fill-in-the-blank': 'Fill in the blank',
    'rapid-fire': 'Rapid-fire',
    jeopardy: 'Jeopardy-style',
    'team-quiz': 'Team quiz',
    mixed: 'Mixed quiz'
};

function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (text) {
        element.textContent = text;
    }
    return element;
}

function valueOf(element, fallback = '') {
    return String(element?.value || fallback).trim();
}

export class TeachingAssistantController {
    constructor({ getContext, addToScreen, notify } = {}) {
        this.getContext = typeof getContext === 'function' ? getContext : () => ({});
        this.addToScreen = typeof addToScreen === 'function' ? addToScreen : () => false;
        this.notify = typeof notify === 'function' ? notify : () => {};
        this.service = new TeachingAssistantService();
        this.mode = 'assistant';
        this.previewResult = null;
        this.activeRequest = null;

        this.panel = document.getElementById('teaching-assistant-panel');
        this.toggleButton = document.getElementById('teaching-assistant-toggle');
        this.closeButton = document.getElementById('teaching-assistant-close');
        this.modeButtons = Array.from(document.querySelectorAll('[data-ai-mode]'));
        this.assistantForm = document.getElementById('teaching-assistant-form');
        this.quizForm = document.getElementById('quiz-master-form');
        this.preview = document.getElementById('teaching-assistant-preview');
        this.status = document.getElementById('teaching-assistant-status');
        this.addButton = document.getElementById('teaching-assistant-add');
        this.clearButton = document.getElementById('teaching-assistant-clear');
        this.connectionInput = document.getElementById('teaching-assistant-api-url');
        this.connectionSaveButton = document.getElementById('teaching-assistant-save-api-url');
        this.connectionCheckButton = document.getElementById('teaching-assistant-check-api');
        this.connectionStatus = document.getElementById('teaching-assistant-connection-status');
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    init() {
        if (!this.panel || !this.toggleButton || !this.assistantForm || !this.quizForm) {
            console.warn('Teaching Assistant could not start because its interface is incomplete.');
            return;
        }

        this.connectionInput.value = this.service.getEndpoint();
        this.toggleButton.addEventListener('click', () => this.togglePanel());
        this.closeButton?.addEventListener('click', () => this.closePanel());
        this.modeButtons.forEach((button) => {
            button.addEventListener('click', () => this.setMode(button.dataset.aiMode));
        });
        this.assistantForm.addEventListener('submit', (event) => this.generate(event, 'assistant'));
        this.quizForm.addEventListener('submit', (event) => this.generate(event, 'quiz'));
        this.addButton?.addEventListener('click', () => this.handleAddToScreen());
        this.clearButton?.addEventListener('click', () => this.clearPreview());
        this.connectionSaveButton?.addEventListener('click', () => this.saveEndpoint());
        this.connectionCheckButton?.addEventListener('click', () => this.checkConnection());
        document.addEventListener('keydown', this.onKeyDown);
        this.setMode('assistant');
        this.renderEmptyPreview();
    }

    onKeyDown(event) {
        if (event.key === 'Escape' && !this.panel.hidden) {
            this.closePanel();
        }
    }

    togglePanel() {
        if (this.panel.hidden) {
            this.openPanel();
        } else {
            this.closePanel();
        }
    }

    openPanel() {
        this.panel.hidden = false;
        this.toggleButton.setAttribute('aria-expanded', 'true');
        this.panel.querySelector('input:not([type="hidden"]), select, textarea, button')?.focus();
    }

    closePanel() {
        this.panel.hidden = true;
        this.toggleButton.setAttribute('aria-expanded', 'false');
        this.toggleButton.focus();
    }

    setMode(mode) {
        this.mode = mode === 'quiz' ? 'quiz' : 'assistant';
        this.modeButtons.forEach((button) => {
            const active = button.dataset.aiMode === this.mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        this.assistantForm.hidden = this.mode !== 'assistant';
        this.quizForm.hidden = this.mode !== 'quiz';
        this.setStatus('');
    }

    buildAssistantRequest() {
        const useContext = document.getElementById('teaching-assistant-use-context')?.checked !== false;
        return {
            mode: 'assistant',
            task: valueOf(document.getElementById('teaching-assistant-task'), 'student-instructions'),
            settings: {
                yearLevel: valueOf(document.getElementById('teaching-assistant-year-level'), 'Year 7'),
                subject: valueOf(document.getElementById('teaching-assistant-subject')),
                request: valueOf(document.getElementById('teaching-assistant-request')),
                useContext
            },
            context: useContext ? this.getContext() : null
        };
    }

    buildQuizRequest() {
        const useContext = document.getElementById('quiz-master-use-context')?.checked !== false;
        return {
            mode: 'quiz',
            task: valueOf(document.getElementById('quiz-master-type'), 'multiple-choice'),
            settings: {
                yearLevel: valueOf(document.getElementById('quiz-master-year-level'), 'Year 7'),
                subject: valueOf(document.getElementById('quiz-master-subject')),
                difficulty: valueOf(document.getElementById('quiz-master-difficulty'), 'standard'),
                questionCount: Number.parseInt(document.getElementById('quiz-master-question-count')?.value, 10) || 10,
                responseMode: valueOf(document.getElementById('quiz-master-response-mode'), 'whole-class'),
                showAnswers: document.getElementById('quiz-master-show-answers')?.checked !== false,
                showExplanations: document.getElementById('quiz-master-show-explanations')?.checked === true,
                request: valueOf(document.getElementById('quiz-master-request')),
                useContext
            },
            context: useContext ? this.getContext() : null
        };
    }

    validateRequest(request) {
        if (!request.settings.subject && !request.settings.request && !request.context) {
            throw new Error('Add a subject/topic or describe what you want the assistant to prepare.');
        }
    }

    async generate(event, mode) {
        event.preventDefault();
        if (this.activeRequest) {
            return;
        }

        this.setMode(mode);
        const request = mode === 'quiz' ? this.buildQuizRequest() : this.buildAssistantRequest();
        try {
            this.validateRequest(request);
        } catch (error) {
            this.setStatus(error.message, 'error');
            return;
        }

        this.previewResult = null;
        this.setLoading(true, mode === 'quiz' ? 'Building quiz preview…' : 'Preparing classroom preview…');
        this.activeRequest = new AbortController();
        try {
            const result = await this.service.generate(request, this.activeRequest.signal);
            this.previewResult = result;
            this.renderPreview(result.proposal);
            const usageText = result.usage?.total_tokens
                ? ` • ${result.usage.total_tokens} tokens used`
                : '';
            this.setStatus(`Preview ready${usageText}. Nothing has been added to the screen yet.`, 'success');
        } catch (error) {
            console.warn('Teaching Assistant request failed:', error);
            this.renderEmptyPreview('No preview was created. Your classroom screen was not changed.');
            const retryText = error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : '';
            this.setStatus(`${error.message}${retryText}`, 'error');
        } finally {
            this.activeRequest = null;
            this.setLoading(false);
        }
    }

    setLoading(isLoading, message = '') {
        this.panel.classList.toggle('is-loading', isLoading);
        this.panel.querySelectorAll('button[type="submit"]').forEach((button) => {
            button.disabled = isLoading;
            const defaultLabel = button.dataset.defaultLabel || button.textContent;
            button.dataset.defaultLabel = defaultLabel;
            button.textContent = isLoading && !button.closest('[hidden]') ? 'Generating…' : defaultLabel;
        });
        if (isLoading) {
            this.setStatus(message, 'loading');
        }
    }

    setStatus(message, type = '') {
        if (!this.status) {
            return;
        }
        this.status.textContent = message;
        this.status.hidden = !message;
        this.status.dataset.status = type;
    }

    clearPreview() {
        this.activeRequest?.abort();
        this.previewResult = null;
        this.renderEmptyPreview();
        this.setStatus('Preview cleared. The classroom screen was not changed.');
    }

    renderEmptyPreview(message = 'Generate a preview to review the content before adding it to the current page.') {
        if (!this.preview) {
            return;
        }
        this.preview.innerHTML = '';
        this.preview.appendChild(createElement('p', 'teaching-assistant-empty', message));
        if (this.addButton) {
            this.addButton.hidden = true;
            this.addButton.disabled = false;
            this.addButton.textContent = 'Add to Screen';
        }
        if (this.clearButton) {
            this.clearButton.hidden = true;
        }
    }

    renderPreview(proposal) {
        this.preview.innerHTML = '';
        const header = createElement('header', 'teaching-assistant-preview__header');
        header.append(
            createElement('p', 'teaching-assistant-preview__eyebrow', proposal.kind === 'quiz' ? 'Quiz preview' : 'Teaching content preview'),
            createElement('h3', '', proposal.title)
        );
        if (proposal.summary) {
            header.appendChild(createElement('p', 'teaching-assistant-preview__summary', proposal.summary));
        }
        this.preview.appendChild(header);

        if (proposal.kind === 'quiz') {
            this.renderQuizPreview(proposal);
        } else {
            this.renderTeachingPreview(proposal);
        }

        this.addButton.hidden = false;
        this.addButton.disabled = false;
        this.addButton.textContent = 'Add to Screen';
        this.clearButton.hidden = false;
    }

    renderTeachingPreview(proposal) {
        const meta = createElement('div', 'teaching-assistant-preview__meta');
        [proposal.yearLevel, proposal.subject, proposal.contentType]
            .filter(Boolean)
            .forEach((value) => meta.appendChild(createElement('span', 'teaching-assistant-chip', value)));
        this.preview.appendChild(meta);

        const content = createElement('div', 'teaching-assistant-preview__content');
        proposal.blocks.forEach((block) => {
            const section = createElement('section', `teaching-assistant-block teaching-assistant-block--${block.type}`);
            if (block.heading) {
                section.appendChild(createElement('h4', '', block.heading));
            }
            if (block.text) {
                section.appendChild(createElement('p', '', block.text));
            }
            if (block.items.length) {
                const list = createElement(block.type === 'numbered' ? 'ol' : 'ul');
                block.items.forEach((item) => list.appendChild(createElement('li', '', item)));
                section.appendChild(list);
            }
            content.appendChild(section);
        });
        this.preview.appendChild(content);
    }

    renderQuizPreview(proposal) {
        const meta = createElement('div', 'teaching-assistant-preview__meta');
        [
            proposal.yearLevel,
            proposal.subject,
            QUIZ_TYPE_LABELS[proposal.quizFormat] || proposal.quizFormat,
            proposal.difficulty,
            `${proposal.questions.length} questions`
        ].filter(Boolean).forEach((value) => meta.appendChild(createElement('span', 'teaching-assistant-chip', value)));
        this.preview.appendChild(meta);

        const list = createElement('ol', 'quiz-master-preview-list');
        proposal.questions.forEach((question) => {
            const item = createElement('li', 'quiz-master-preview-question');
            const questionMeta = createElement('div', 'quiz-master-preview-question__meta');
            questionMeta.appendChild(createElement('span', 'teaching-assistant-chip', QUIZ_TYPE_LABELS[question.type] || question.type));
            if (question.category) {
                questionMeta.appendChild(createElement('span', 'teaching-assistant-chip teaching-assistant-chip--muted', question.category));
            }
            if (question.points > 1) {
                questionMeta.appendChild(createElement('span', 'teaching-assistant-chip teaching-assistant-chip--points', `${question.points} points`));
            }
            item.append(questionMeta, createElement('p', 'quiz-master-preview-question__prompt', question.prompt));

            if (question.type === 'matching' && question.pairs.length) {
                const pairs = createElement('ul', 'quiz-master-preview-options');
                question.pairs.forEach((pair) => pairs.appendChild(createElement('li', '', `${pair.left} ↔ ${pair.right}`)));
                item.appendChild(pairs);
            } else if (question.type === 'ordering' && question.items.length) {
                const ordered = createElement('ol', 'quiz-master-preview-options');
                question.items.forEach((orderedItem) => ordered.appendChild(createElement('li', '', orderedItem)));
                item.appendChild(ordered);
            } else if (question.choices.length) {
                const choices = createElement('ul', 'quiz-master-preview-options');
                question.choices.forEach((choice) => choices.appendChild(createElement('li', '', choice)));
                item.appendChild(choices);
            }

            if (proposal.showAnswers && question.answerText) {
                item.appendChild(createElement('p', 'quiz-master-preview-answer', `Answer: ${question.answerText}`));
            }
            if (proposal.showExplanations && question.explanation) {
                item.appendChild(createElement('p', 'quiz-master-preview-explanation', `Explanation: ${question.explanation}`));
            }
            list.appendChild(item);
        });
        this.preview.appendChild(list);
    }

    handleAddToScreen() {
        const proposal = this.previewResult?.proposal;
        if (!proposal) {
            this.setStatus('Generate a preview before adding anything to the screen.', 'error');
            return;
        }

        const added = this.addToScreen(proposal);
        if (!added) {
            this.setStatus('Teacher Screen could not add the preview. Nothing was changed.', 'error');
            return;
        }

        this.addButton.disabled = true;
        this.addButton.textContent = 'Added to Screen';
        this.setStatus('Added to the current page. You can now move, resize, edit, or remove the widget.', 'success');
    }

    saveEndpoint() {
        try {
            const endpoint = this.service.setEndpoint(this.connectionInput.value);
            this.connectionInput.value = endpoint;
            this.setConnectionStatus('Backend address saved in this browser.', 'success');
        } catch (error) {
            this.setConnectionStatus(error.message, 'error');
        }
    }

    async checkConnection() {
        try {
            this.saveEndpoint();
            this.connectionCheckButton.disabled = true;
            this.setConnectionStatus('Checking secure backend…', 'loading');
            const result = await this.service.checkConnection();
            if (result.configured === false) {
                throw new Error('The backend is online, but OPENAI_API_KEY is not configured on the server.');
            }
            this.setConnectionStatus(`Secure backend ready${result.model ? ` • ${result.model}` : ''}.`, 'success');
        } catch (error) {
            this.setConnectionStatus(error.message, 'error');
        } finally {
            this.connectionCheckButton.disabled = false;
        }
    }

    setConnectionStatus(message, type = '') {
        if (!this.connectionStatus) {
            return;
        }
        this.connectionStatus.textContent = message;
        this.connectionStatus.dataset.status = type;
    }
}
