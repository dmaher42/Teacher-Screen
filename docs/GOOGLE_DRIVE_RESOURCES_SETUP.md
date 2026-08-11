# Google Drive resources setup

Teacher Screen's Resources Library works with a computer folder without any cloud credentials. The Google Drive tab remains safely disabled until its public browser identifiers are configured.

## Google Cloud setup

1. Create or choose a Google Cloud project.
2. Enable the Google Drive API and Google Picker API.
3. Configure the OAuth consent screen. For an initial private trial, add the teacher's Google account as a test user.
4. Create a Web application OAuth client and add the allowed JavaScript origins:
   - Local testing: `http://127.0.0.1:4173`
   - Current public app: `https://dmaher42.github.io`
5. Create a browser API key. Restrict it to the approved website origins and to the Google Picker API.
6. Find the Google Cloud project number. Google Picker uses this as its app ID.

## Teacher Screen configuration

Open `js/config/google-drive-config.js` and add:

- `clientId`: the Web OAuth client ID.
- `apiKey`: the restricted browser API key.
- `appId`: the Google Cloud project number.
- `folderName`: the visible Drive folder Teacher Screen should create or reuse.

These values identify the public browser application. Do not add an OAuth client secret, refresh token, access token, school password, or service-account key to this repository.

Teacher Screen requests only `https://www.googleapis.com/auth/drive.file`. It can work with the visible folder and files it creates, plus files the teacher explicitly selects. The temporary access token stays in memory and is discarded when the page closes or the teacher disconnects.

## Verification

After configuration:

1. Run `npm run serve`.
2. Open Dashboard -> Resources -> Google Drive.
3. Select **Connect Google Drive** and complete the Google consent window.
4. Confirm the visible `Teacher Screen Resources` folder appears in Drive.
5. Test a PDF, PowerPoint, image, and Google Slides file.
6. Run `npm run check:all` before release.

School Google Workspace policies may require an administrator to trust the OAuth application before staff accounts can connect.
