'use strict';

const source = document.querySelector('#source');
const copy = document.querySelector('#copy');
const status = document.querySelector('#copy-status');

fetch('nextcloud-folder-gallery.user.js', { credentials: 'omit' })
  .then(response => {
    if (!response.ok) throw new Error('Source download failed.');
    return response.text();
  })
  .then(text => {
    if (!text.startsWith('// ==UserScript==')) throw new Error('Unexpected source response.');
    source.value = text;
    copy.disabled = false;
  })
  .catch(() => {
    source.value = 'Could not load the source. Use the Download script link above.';
    status.textContent = 'Source unavailable.';
  });

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(source.value);
    status.textContent = 'Copied.';
  } catch {
    source.focus();
    source.select();
    status.textContent = 'Source selected. Use your browser\'s Copy command.';
  }
});
