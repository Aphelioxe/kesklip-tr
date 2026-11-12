'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function startMediaServer({ token, logger = console }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        });
        response.end();
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' });
        response.end('Yöntem desteklenmiyor.');
        return;
      }

      if (requestUrl.pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        response.end('ok');
        return;
      }

      if (requestUrl.pathname !== '/file') {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Bulunamadı.');
        return;
      }

      if (!tokenMatches(requestUrl.searchParams.get('token'), token)) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Erişim reddedildi.');
        return;
      }

      const filePath = requestUrl.searchParams.get('path');
      if (!filePath) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Dosya yolu gerekli.');
        return;
      }

      let stat;
      try {
        stat = fs.statSync(filePath);
        if (!stat.isFile()) throw new Error('not a file');
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Dosya bulunamadı.');
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[extension] || 'application/octet-stream';
      const baseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
        'Content-Type': contentType,
        'Cross-Origin-Resource-Policy': 'cross-origin',
      };

      const rangeHeader = request.headers.range;
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
        if (!match) {
          response.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
          response.end();
          return;
        }

        let start;
        let end;
        if (match[1] === '' && match[2] !== '') {
          const suffixLength = Number(match[2]);
          start = Math.max(0, stat.size - suffixLength);
          end = stat.size - 1;
        } else {
          start = Number(match[1] || 0);
          end = match[2] === '' ? stat.size - 1 : Math.min(Number(match[2]), stat.size - 1);
        }

        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
          response.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` });
          response.end();
          return;
        }

        const chunkSize = end - start + 1;
        response.writeHead(206, {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': chunkSize,
        });

        if (request.method === 'HEAD') {
          response.end();
          return;
        }

        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', (error) => {
          logger.warn?.('Medya akışı hatası:', error.message);
          try { response.destroy(error); } catch { /* ignore */ }
        });
        stream.pipe(response);
        return;
      }

      response.writeHead(200, {
        ...baseHeaders,
        'Content-Length': stat.size,
      });

      if (request.method === 'HEAD') {
        response.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on('error', (error) => {
        logger.warn?.('Medya akışı hatası:', error.message);
        try { response.destroy(error); } catch { /* ignore */ }
      });
      stream.pipe(response);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

module.exports = { startMediaServer };
