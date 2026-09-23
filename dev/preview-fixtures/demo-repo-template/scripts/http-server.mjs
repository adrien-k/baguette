import http from 'http';

const envVar = process.argv[2] || 'PORT';
const label = process.argv[3] || 'server';
const port = Number(process.env[envVar]);
if (!port) {
  console.error(`Missing port env var ${envVar}`);
  process.exit(1);
}

http
  .createServer((_req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(`${label}\n`);
  })
  .listen(port, '127.0.0.1', () => {
    console.log(`[baguette-fixture] ${label} listening on 127.0.0.1:${port}`);
  });
