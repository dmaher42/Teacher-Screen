const handler = require('../api/teaching-assistant.js');
const fs = require('fs');
const path = require('path');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
    console.log(`PASS: ${message}`);
}

function invokeHandler({ method = 'GET', origin = 'http://127.0.0.1:4173', body = null, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const responseHeaders = {};
        const req = {
            method,
            body,
            headers: {
                origin,
                ...(body ? { 'content-type': 'application/json' } : {}),
                ...headers
            },
            socket: { remoteAddress: '127.0.0.1' }
        };
        const res = {
            statusCode: 200,
            setHeader(name, value) {
                responseHeaders[String(name).toLowerCase()] = String(value);
            },
            end(value = '') {
                let parsed = null;
                if (value) {
                    try {
                        parsed = JSON.parse(value);
                    } catch (error) {
                        reject(error);
                        return;
                    }
                }
                resolve({ status: this.statusCode, headers: responseHeaders, body: parsed });
            }
        };

        Promise.resolve(handler(req, res)).catch(reject);
    });
}

async function run() {
    const originalFetch = global.fetch;
    const originalEnv = {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_MODEL: process.env.OPENAI_MODEL,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
        SAFETY_ID_SALT: process.env.SAFETY_ID_SALT
    };
    let upstreamRequest = null;

    try {
        process.env.OPENAI_API_KEY = 'server-only-test-key';
        process.env.OPENAI_MODEL = 'gpt-5.6-sol';
        process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:4173';
        process.env.SAFETY_ID_SALT = 'test-salt-not-for-production';

        const health = await invokeHandler();
        assert(health.status === 200 && health.body?.configured === true, 'AI route health check should report server configuration without calling OpenAI');
        assert(JSON.stringify(health.body).includes('server-only-test-key') === false, 'AI route health response should never expose the API key');

        let fetchCalledForBlockedOrigin = false;
        global.fetch = async () => {
            fetchCalledForBlockedOrigin = true;
            throw new Error('Blocked origin should not reach OpenAI');
        };
        const blocked = await invokeHandler({ method: 'POST', origin: 'https://untrusted.example', body: { mode: 'assistant' } });
        assert(blocked.status === 403, 'AI route should reject website origins outside the allowlist');
        assert(fetchCalledForBlockedOrigin === false, 'Rejected origins should not spend an OpenAI request');

        const mockProposal = {
            kind: 'quiz',
            title: 'Fractions Team Challenge',
            summary: 'A short matching quiz about equivalent fractions.',
            yearLevel: 'Year 7',
            subject: 'Mathematics - fractions',
            difficulty: 'standard',
            quizFormat: 'matching',
            responseMode: 'teams',
            showAnswers: true,
            showExplanations: true,
            teams: ['Team 1', 'Team 2'],
            questions: [1, 2, 3].map((number) => ({
                type: 'matching',
                category: 'Equivalent fractions',
                points: number,
                prompt: `Match fraction set ${number}.`,
                choices: ['1/2', '2/3', '3/4'],
                answerIndex: 0,
                answerText: 'Pairs shown',
                acceptedAnswers: ['Pairs shown'],
                pairs: [{ left: `${number}/${number * 2}`, right: '1/2' }],
                items: [],
                explanation: 'Equivalent fractions represent the same value.'
            }))
        };

        global.fetch = async (url, options) => {
            upstreamRequest = { url, options, body: JSON.parse(options.body) };
            return {
                ok: true,
                status: 200,
                async json() {
                    return {
                        status: 'completed',
                        output: [{
                            type: 'message',
                            content: [{ type: 'output_text', text: JSON.stringify(mockProposal) }]
                        }],
                        usage: { input_tokens: 200, output_tokens: 300, total_tokens: 500 }
                    };
                }
            };
        };

        const generated = await invokeHandler({
            method: 'POST',
            body: {
                mode: 'quiz',
                task: 'matching',
                clientId: 'browser-test-client',
                settings: {
                    yearLevel: 'Year 7',
                    subject: 'Mathematics - fractions',
                    difficulty: 'standard',
                    questionCount: 3,
                    responseMode: 'teams',
                    showAnswers: true,
                    showExplanations: true,
                    useContext: true
                },
                context: {
                    deckName: 'Fractions',
                    pageName: 'Equivalent fractions',
                    lessonPlan: 'Review equivalent fractions.',
                    widgets: [{
                        type: 'RichTextWidget',
                        label: 'Text Board',
                        text: 'Equivalent fractions have the same value.',
                        privateStudentNames: ['This must not leave the server validator']
                    }]
                }
            }
        });

        assert(generated.status === 200 && generated.body?.proposal?.questions?.length === 3, 'Quiz Master route should return the requested structured quiz proposal');
        assert(upstreamRequest?.url === 'https://api.openai.com/v1/responses', 'AI route should use the OpenAI Responses API');
        assert(upstreamRequest?.options?.headers?.Authorization === 'Bearer server-only-test-key', 'OpenAI authorization should be attached only by the server route');
        assert(upstreamRequest?.body?.store === false, 'OpenAI request should disable response storage');
        assert(upstreamRequest?.body?.text?.format?.type === 'json_schema' && upstreamRequest.body.text.format.strict === true, 'OpenAI request should require strict structured output');
        assert(upstreamRequest?.body?.max_output_tokens <= 12000, 'OpenAI request should enforce an output-token ceiling');
        assert(upstreamRequest?.body?.safety_identifier && !upstreamRequest.body.safety_identifier.includes('browser-test-client'), 'OpenAI safety identifier should be stable and privacy-preserving');
        assert(JSON.stringify(upstreamRequest?.body).includes('privateStudentNames') === false, 'Server context validation should strip unapproved private widget fields');
        assert(JSON.stringify(generated.body).includes('server-only-test-key') === false, 'Generated response should never expose the server API key');

        const internal = handler._internal;
        const supportedQuizTypes = [
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
        const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
        assert(
            supportedQuizTypes.every((type) => indexHtml.includes(`value="${type}"`)),
            'Quiz Master form should expose every requested quiz type'
        );
        assert(
            supportedQuizTypes.every((type) => internal.quizSchema.properties.quizFormat.enum.includes(type)),
            'Quiz structured-output schema should support every requested quiz type'
        );
        const clamped = internal.validateRequest({
            mode: 'quiz',
            task: 'mixed',
            settings: { subject: 'Science', questionCount: 99 }
        });
        assert(clamped.settings.questionCount === 20, 'Quiz request validation should cap generation at 20 questions');
        assert(internal.quizSchema.additionalProperties === false, 'Quiz structured-output schema should reject undeclared root fields');

        const malformed = await invokeHandler({ method: 'POST', body: Buffer.from('{not-json') });
        assert(malformed.status === 400, 'AI route should reject malformed request JSON without calling OpenAI');

        delete process.env.OPENAI_API_KEY;
        const unconfigured = await invokeHandler();
        assert(unconfigured.status === 200 && unconfigured.body?.configured === false, 'Health check should clearly report when the server key is missing');
        console.log('Teaching Assistant API contract tests passed.');
    } finally {
        global.fetch = originalFetch;
        Object.entries(originalEnv).forEach(([key, value]) => {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        });
    }
}

run().catch((error) => {
    console.error(`Teaching Assistant API contract test failed: ${error.message}`);
    process.exitCode = 1;
});
