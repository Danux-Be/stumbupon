const VIDEO_ID_RE = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /\/shorts\/([a-zA-Z0-9_-]{11})/,
  /\/embed\/([a-zA-Z0-9_-]{11})/,
];

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com']);

function isYouTubeUrl(url) {
  try {
    const host = new URL(url).hostname;
    return YOUTUBE_HOSTS.has(host);
  } catch { return false; }
}

function extractVideoId(url) {
  for (const re of VIDEO_ID_RE) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

function toWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function toEmbedUrl(videoId) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
}

async function fetchYouTubeMeta(watchUrl) {
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
    const res = await fetch(oembed, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: data.title || null,
      author: data.author_name || null,
    };
  } catch { return null; }
}

module.exports = { isYouTubeUrl, extractVideoId, toWatchUrl, toEmbedUrl, fetchYouTubeMeta };
