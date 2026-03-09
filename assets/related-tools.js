document.addEventListener("DOMContentLoaded", function () {

const tools = [
{ name: "Free MP3 Cutter", url: "/free-mp3-cutter.html" },
{ name: "Audio Cutter Online", url: "/audio-cutter-online.html" },
{ name: "Normalize Audio Volume", url: "/normalize-audio-volume.html" },
{ name: "Remove Silence from Recording", url: "/remove-silence-from-audio.html" },
{ name: "Merge Multiple Audio Clips", url: "/merge-audio-files.html" },
{ name: "Extract Audio from Video", url: "/extract-audio-from-video.html" },
{ name: "Convert Trimmed MP3 to WAV", url: "/convert-mp3-to-wav.html" },
{ name: "Audio Converter", url: "/audio-converter.html" },
{ name: "Audio Speed Changer", url: "/audio-speed-changer.html" },
{ name: "Audio Pitch Changer", url: "/audio-pitch-changer.html" }
];

const container = document.getElementById("related-tools");

if (!container) return;

const currentPage = window.location.pathname;

let html = `
<section class="content-section section-surface">
<h2>Related Audio Tools</h2>
<div class="related-grid">
`;

tools.forEach(tool => {
if (!currentPage.includes(tool.url)) {
html += `<a class="tool-btn" href="${tool.url}">${tool.name}</a>`;
}
});

html += "</div></section>";

container.innerHTML = html;

});