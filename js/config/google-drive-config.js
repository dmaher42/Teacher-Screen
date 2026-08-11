(function configureTeacherScreenGoogleDrive(global) {
    if (!global || global.TEACHER_SCREEN_GOOGLE_DRIVE) {
        return;
    }

    // These are public browser identifiers, not passwords or client secrets.
    // Keep them blank until the Google Cloud project and allowed origins exist.
    global.TEACHER_SCREEN_GOOGLE_DRIVE = Object.freeze({
        clientId: '',
        apiKey: '',
        appId: '',
        folderName: 'Teacher Screen Resources'
    });
})(typeof window !== 'undefined' ? window : null);
