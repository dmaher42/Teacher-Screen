const DEFAULT_API_PATH = '/api/teaching-assistant';
const API_ENDPOINT_STORAGE_KEY = 'teacherScreenAiApiUrl';
const CLIENT_ID_STORAGE_KEY = 'teacherScreenAiClientId';
const REQUEST_TIMEOUT_MS = 60000;

export const QUIZ_TYPE_OPTIONS = [
    'multiple-choice',
    'true-false',
    'short-answer',
    'matching',
    'ordering',
    'fill-in-the-blank',
    'rapid-fire',
    'jeopardy',
    'team-quiz',
    'mixed'
];

const ASSISTANT_BLOCK_TYPES = ['heading', 'paragraph', 'bullets', 'numbered', 'callout'];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function cleanText(value, maxLength = 4000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanStringArray(value, maxItems = 20, maxLength = 500) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => cleanText(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems);
}

function normalizePair(pair) {
    if (!pair || typeof pair !== 'object') {
        return null;
    }

    const left = cleanText(pair.left, 300);
    const right = cleanText(pair.right, 300);
    return left && right ? { left, right } : null;
}

function normalizeQuestion(question, fallbackType = 'multiple-choice') {
    if (!question || typeof question !== 'object') {
        return null;
    }

    const type = QUIZ_TYPE_OPTIONS.includes(question.type) && !['team-quiz', 'mixed'].includes(question.type)
        ? question.type
        : (QUIZ_TYPE_OPTIONS.includes(fallbackType) && !['team-quiz', 'mixed'].includes(fallbackType)
            ? fallbackType
            : 'multiple-choice');
    const prompt = cleanText(question.prompt || question.question, 1000);
    if (!prompt) {
        return null;
    }

    let choices = cleanStringArray(question.choices, 8, 300);
    const acceptedAnswers = cleanStringArray(question.acceptedAnswers, 12, 300);
    const pairs = Array.isArray(question.pairs)
        ? question.pairs.map(normalizePair).filter(Boolean).slice(0, 10)
        : [];
    const items = cleanStringArray(question.items, 12, 300);
    let answerIndex = Number.parseInt(question.answerIndex ?? question.answer, 10);
    let answerText = cleanText(question.answerText, 1600);

    if (type === 'true-false') {
        choices = ['True', 'False'];
        if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 1) {
            answerIndex = /^false$/i.test(answerText) ? 1 : 0;
        }
        answerText = choices[answerIndex];
    } else if (type === 'multiple-choice' || (type === 'rapid-fire' && choices.length >= 2) || type === 'jeopardy') {
        if (choices.length >= 2) {
            if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length) {
                answerIndex = 0;
            }
            answerText = answerText || choices[answerIndex];
        }
    } else if (type === 'matching' && pairs.length) {
        answerText = answerText || pairs.map((pair) => `${pair.left} → ${pair.right}`).join('; ');
        if (!choices.length) {
            choices = pairs.map((pair) => pair.right).reverse();
        }
    } else if (type === 'ordering' && items.length) {
        answerText = answerText || items.map((item, index) => `${index + 1}. ${item}`).join(' ');
        if (!choices.length) {
            choices = [...items].reverse();
        }
    }

    if (!answerText) {
        answerText = acceptedAnswers[0] || '';
    }

    return {
        type,
        category: cleanText(question.category, 120),
        points: clamp(Number.parseInt(question.points, 10) || 1, 1, 1000),
        question: prompt,
        prompt,
        choices,
        answer: Number.isInteger(answerIndex) ? answerIndex : 0,
        answerIndex: Number.isInteger(answerIndex) ? answerIndex : 0,
        answerText,
        acceptedAnswers,
        pairs,
        items,
        explanation: cleanText(question.explanation, 1200)
    };
}

export function normalizeTeachingProposal(value) {
    const proposal = value && typeof value === 'object' ? value : {};
    const blocks = Array.isArray(proposal.blocks)
        ? proposal.blocks.map((block) => {
            if (!block || typeof block !== 'object') {
                return null;
            }

            const type = ASSISTANT_BLOCK_TYPES.includes(block.type) ? block.type : 'paragraph';
            const heading = cleanText(block.heading, 200);
            const text = cleanText(block.text, 2000);
            const items = cleanStringArray(block.items, 15, 600);
            if (!heading && !text && !items.length) {
                return null;
            }
            return { type, heading, text, items };
        }).filter(Boolean).slice(0, 12)
        : [];

    if (!blocks.length) {
        throw new Error('The assistant returned an empty classroom proposal. Please try again.');
    }

    return {
        kind: 'teaching-content',
        title: cleanText(proposal.title, 200) || 'Teaching Assistant',
        summary: cleanText(proposal.summary, 700),
        yearLevel: cleanText(proposal.yearLevel, 80),
        subject: cleanText(proposal.subject, 160),
        contentType: cleanText(proposal.contentType, 80),
        blocks
    };
}

export function normalizeQuizProposal(value) {
    const proposal = value && typeof value === 'object' ? value : {};
    const quizFormat = QUIZ_TYPE_OPTIONS.includes(proposal.quizFormat)
        ? proposal.quizFormat
        : 'mixed';
    const questions = Array.isArray(proposal.questions)
        ? proposal.questions
            .map((question) => normalizeQuestion(question, quizFormat))
            .filter(Boolean)
            .slice(0, 20)
        : [];

    if (!questions.length) {
        throw new Error('The Quiz Master returned no usable questions. Please try again.');
    }

    const responseMode = ['whole-class', 'teams', 'individual', 'verbal'].includes(proposal.responseMode)
        ? proposal.responseMode
        : (quizFormat === 'team-quiz' ? 'teams' : 'whole-class');

    return {
        kind: 'quiz',
        title: cleanText(proposal.title, 200) || 'Class Quiz',
        summary: cleanText(proposal.summary, 700),
        yearLevel: cleanText(proposal.yearLevel, 80),
        subject: cleanText(proposal.subject, 160),
        difficulty: cleanText(proposal.difficulty, 80),
        quizFormat,
        responseMode,
        showAnswers: proposal.showAnswers !== false,
        showExplanations: proposal.showExplanations === true,
        teams: cleanStringArray(proposal.teams, 6, 80),
        questions
    };
}

function getConfiguredEndpoint() {
    try {
        const stored = localStorage.getItem(API_ENDPOINT_STORAGE_KEY);
        if (stored) {
            return stored;
        }
    } catch (error) {
        // Local storage can be unavailable in private or hardened browser modes.
    }

    return cleanText(window.TEACHER_SCREEN_CONFIG?.aiApiUrl, 1000) || DEFAULT_API_PATH;
}

function validateEndpoint(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
        return DEFAULT_API_PATH;
    }

    if (trimmed.startsWith('/')) {
        return trimmed;
    }

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch (error) {
        throw new Error('Enter a complete HTTPS backend URL.');
    }

    const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
        throw new Error('The backend URL must use HTTPS (local testing may use http://localhost).');
    }

    return parsed.toString().replace(/\/$/, '');
}

function getClientId() {
    try {
        const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
        if (existing) {
            return existing;
        }

        const next = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
        return next;
    } catch (error) {
        return `session-${Math.random().toString(36).slice(2)}`;
    }
}

async function readJsonResponse(response) {
    let payload = null;
    try {
        payload = await response.json();
    } catch (error) {
        if (!response.ok) {
            throw new Error(`The AI backend returned an unreadable error (${response.status}).`);
        }
    }

    if (!response.ok) {
        const message = cleanText(payload?.error?.message || payload?.message, 700)
            || `The AI backend returned error ${response.status}.`;
        const error = new Error(message);
        error.status = response.status;
        error.retryAfter = response.headers.get('Retry-After');
        throw error;
    }

    return payload || {};
}

export class TeachingAssistantService {
    constructor() {
        this.endpoint = getConfiguredEndpoint();
    }

    getEndpoint() {
        return this.endpoint;
    }

    setEndpoint(value) {
        this.endpoint = validateEndpoint(value);
        try {
            if (this.endpoint === DEFAULT_API_PATH) {
                localStorage.removeItem(API_ENDPOINT_STORAGE_KEY);
            } else {
                localStorage.setItem(API_ENDPOINT_STORAGE_KEY, this.endpoint);
            }
        } catch (error) {
            // Keep the endpoint for this session even if persistence is unavailable.
        }
        return this.endpoint;
    }

    async request(method, body = null, externalSignal = null, timeoutMs = REQUEST_TIMEOUT_MS) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(new Error('The AI request timed out.')), timeoutMs);
        const abortFromExternal = () => controller.abort(externalSignal?.reason);
        externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

        try {
            const response = await fetch(this.endpoint, {
                method,
                credentials: 'omit',
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            return await readJsonResponse(response);
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error('The AI request was cancelled or took too long. Please try again.');
            }
            if (error instanceof TypeError) {
                throw new Error('Teacher Screen could not reach the AI backend. Check the backend URL and deployment setup.');
            }
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
            externalSignal?.removeEventListener('abort', abortFromExternal);
        }
    }

    async checkConnection() {
        return this.request('GET', null, null, 12000);
    }

    async generate(request, signal = null) {
        const payload = {
            ...request,
            clientId: getClientId()
        };
        const result = await this.request('POST', payload, signal);
        const proposal = request.mode === 'quiz'
            ? normalizeQuizProposal(result.proposal)
            : normalizeTeachingProposal(result.proposal);

        return {
            proposal,
            usage: result.usage || null,
            limits: result.limits || null,
            model: cleanText(result.model, 120)
        };
    }
}
