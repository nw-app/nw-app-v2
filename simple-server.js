const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  // 移除查詢字串以獲取正確的檔案路徑
  let requestUrl = req.url.split('?')[0];
  requestUrl = String(requestUrl || "/");
  if (requestUrl.includes("#")) requestUrl = requestUrl.split("#")[0];

  let filePath = '.' + requestUrl;
  if (filePath === './') filePath = './index.html';
  if (filePath === './admin') filePath = './admin.html';
  if (filePath === './admin/') filePath = './admin.html';

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  };
  if (String(filePath).endsWith('/sw.js') || String(filePath).endsWith('\\sw.js') || filePath === './sw.js') {
    headers['Service-Worker-Allowed'] = '/';
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if(error.code == 'ENOENT') {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end('File not found');
      } else {
        res.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end('Error: ' + error.code);
      }
    } else {
      res.writeHead(200, headers);
      res.end(content, 'utf-8');
    }
  });
});

server.listen(8081, () => {
  console.log('Server running at http://localhost:8081/');
});
