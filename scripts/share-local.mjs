// Explicit LAN sharing for testing. Keeps the existing local app (and its provider queue) running.
// Run only on a trusted private network; never forward this port to the public internet.
import http from 'node:http';
import net from 'node:net';
const port = Number(process.env.LAN_PORT || 3001);
const upstreamPort = Number(process.env.LOCAL_APP_PORT || 3000);
const server = http.createServer((req, res) => {
  const upstream = http.request({ host: '127.0.0.1', port: upstreamPort,
    path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress || 'unknown' } }, (reply) => {
    res.writeHead(reply.statusCode || 502, reply.headers);
    reply.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Local app unavailable'); });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
});
// Forward Vite's development websocket too, for live UI updates during phone testing.
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(upstreamPort, '127.0.0.1', () => {
    const headers = Object.entries(req.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n');
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
server.requestTimeout = 0;
server.listen(port, '0.0.0.0', () => console.log(`LAN testing enabled on port ${port}; forwards to localhost:${upstreamPort}.`));
