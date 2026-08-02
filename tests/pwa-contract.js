const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const manifestPath = path.join(projectRoot, 'manifest.webmanifest');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

assert.match(
    indexHtml,
    /<link\s+rel=["']manifest["']\s+href=["']manifest\.webmanifest["']\s*\/?>/i,
    'index.html should link the installable app manifest'
);
assert.match(indexHtml, /<title>Teacher Screen<\/title>/i, 'The app window should use the Teacher Screen name');
assert.equal(manifest.name, 'Teacher Screen', 'Manifest should use the product name');
assert.equal(manifest.short_name, 'Teacher', 'Manifest should provide a compact launcher name');
assert.equal(manifest.id, './', 'Manifest id should remain relative to the hosting directory');
assert.equal(manifest.start_url, './', 'Manifest start_url should work locally and under GitHub Pages');
assert.equal(manifest.scope, './', 'Manifest scope should work locally and under GitHub Pages');
assert.equal(manifest.display, 'standalone', 'Installed Teacher Screen should remove browser navigation chrome');
assert.equal(manifest.theme_color, '#111827', 'Manifest theme colour should match the page chrome colour');
assert.equal(manifest.background_color, '#111827', 'Manifest launch colour should match the app identity');
assert.equal(manifest.prefer_related_applications, false, 'The web app should remain the preferred install target');
assert(Array.isArray(manifest.icons), 'Manifest should provide app icons');

const readPngDimensions = (filePath) => {
    const bytes = fs.readFileSync(filePath);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    assert(bytes.subarray(0, 8).equals(pngSignature), `${path.basename(filePath)} should be a PNG file`);
    return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20)
    };
};

for (const requiredSize of [192, 512]) {
    const sizeLabel = `${requiredSize}x${requiredSize}`;
    const icon = manifest.icons.find((candidate) => candidate.sizes === sizeLabel && candidate.type === 'image/png');
    assert(icon, `Manifest should provide a ${sizeLabel} PNG icon`);
    assert(!icon.src.startsWith('/') && !icon.src.includes('..'), `${sizeLabel} icon path should stay relative and scoped`);

    const iconPath = path.resolve(projectRoot, icon.src);
    assert(iconPath.startsWith(projectRoot + path.sep), `${sizeLabel} icon should stay inside the project`);
    assert(fs.existsSync(iconPath), `${sizeLabel} icon file should exist`);
    assert.deepEqual(
        readPngDimensions(iconPath),
        { width: requiredSize, height: requiredSize },
        `${sizeLabel} icon should have the declared dimensions`
    );
}

const maskableIcon = manifest.icons.find((icon) => icon.sizes === '512x512' && icon.purpose?.split(/\s+/).includes('maskable'));
assert(maskableIcon, 'Manifest should provide a 512x512 maskable icon');

console.log('PWA manifest checks passed.');
