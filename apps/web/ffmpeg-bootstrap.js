if (!process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = '/usr/bin/ffmpeg';
}
try {
  const ff = require('fluent-ffmpeg');
  ff.setFfmpegPath(process.env.FFMPEG_PATH);
} catch (_) {}
console.log('[ffmpeg-bootstrap] FFMPEG_PATH=', process.env.FFMPEG_PATH);
