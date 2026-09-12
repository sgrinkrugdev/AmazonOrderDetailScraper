document.getElementById('start').value = '2026-06-01';
document.getElementById('end').value = '2026-09-10';
const version = document.createElement('div');
version.textContent = `Version ${chrome.runtime.getManifest().version}`;
version.style.cssText = 'color:#666;font-size:11px;margin:0 0 8px';
document.querySelector('h3')?.after(version);
