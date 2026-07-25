# Teaching Assistant and Quiz Master setup

Teacher Screen stays on GitHub Pages. The OpenAI key stays in a separate Vercel server function and is never sent to the browser.

```text
Teacher Screen on GitHub Pages
        |
        | HTTPS request with lesson settings and selected page context
        v
Vercel /api/teaching-assistant
        |
        | OPENAI_API_KEY is read from Vercel's private environment
        v
OpenAI Responses API
```

## What is already protected

- The frontend has no API-key field and contains no OpenAI key.
- The server accepts only configured website origins.
- Requests are capped at 20 quiz questions, 28 KB of input, and a configurable output-token limit.
- The default throttle is 30 requests per client per hour and 100 per day.
- OpenAI calls time out instead of leaving the interface loading forever.
- Model output must match a strict JSON schema and is normalised again before it becomes a preview.
- The model can only propose content. A teacher must choose **Add to Screen** before the existing widget system changes.
- Private behaviour records, student names, notes, URLs, and arbitrary widget data are not included in page context.

The built-in throttle is a useful first guard, but serverless instances can restart or scale independently. For a firm account-wide ceiling, also set OpenAI project budget alerts and use Vercel Firewall rate limiting or a shared rate-limit store.

## 1. Create a separate OpenAI project key

1. In the OpenAI Platform, create a project for Teacher Screen.
2. Create a project API key with only the access this app needs.
3. Set project budget alerts and review usage regularly.
4. Copy the key once. Do not paste it into Teacher Screen, GitHub, a JavaScript file, or this repository.

OpenAI API billing is separate from a ChatGPT subscription.

## 2. Deploy the secure route to Vercel

1. Import the existing `Teacher-Screen` GitHub repository into Vercel.
2. Leave the framework preset as **Other**. No frontend build command is required for the API route.
3. In **Project Settings > Environment Variables**, add:

   - `OPENAI_API_KEY`: the private project key.
   - `ALLOWED_ORIGINS`: `https://dmaher42.github.io` for the current GitHub Pages site. Add more origins as a comma-separated list only when needed.
   - `SAFETY_ID_SALT`: a long random value.

4. Optional controls:

   - `OPENAI_MODEL`: defaults to `gpt-5.6-sol`. `gpt-5.6-terra` is a lower-cost alternative to evaluate.
   - `AI_REQUESTS_PER_HOUR`: defaults to `30`.
   - `AI_REQUESTS_PER_DAY`: defaults to `100`.
   - `AI_MAX_OUTPUT_TOKENS`: defaults to `6000` and is clamped between 800 and 12000.
   - `AI_TIMEOUT_MS`: defaults to `55000` and is capped below the function duration.

5. Deploy, then open:

   `https://YOUR-VERCEL-PROJECT.vercel.app/api/teaching-assistant`

   A healthy route returns JSON with `"ok": true` and `"configured": true`. It never returns the API key.

## 3. Connect Teacher Screen

1. Open Teacher Screen and enter the **Classroom**.
2. Choose **AI** in the lesson toolbar.
3. Open **Secure AI connection** at the bottom of the panel.
4. Enter the full deployed route:

   `https://YOUR-VERCEL-PROJECT.vercel.app/api/teaching-assistant`

5. Choose **Save Address**, then **Check Connection**.

The address is stored only in that browser's local storage. It is not an API key and can be changed at any time.

## Local test

With the Vercel CLI available, create a local `.env` file containing the real values and run:

```powershell
npx vercel dev
```

Do not commit `.env`; it is ignored by Git. The automated repository tests use a mock provider and never spend OpenAI credits.

## Troubleshooting

- **Backend online, but OPENAI_API_KEY is not configured**: add the key in Vercel Environment Variables and redeploy.
- **Website origin is not allowed**: add the exact site origin to `ALLOWED_ORIGINS`, without a trailing slash, then redeploy.
- **Usage limit reached**: wait for the window to reset or deliberately adjust the Vercel environment limits.
- **OpenAI is rate-limiting this project**: wait briefly and check the OpenAI project's usage tier and limits.
- **Could not reach the AI backend**: confirm the full HTTPS route, Vercel deployment status, and browser network access.
- **Unexpected cost**: disable or rotate the Vercel `OPENAI_API_KEY`, inspect OpenAI usage, and lower both app and provider limits before re-enabling.
