import { createServer } from 'node:http';
import handler from '../api/feedback.ts';

const port = Number(process.env.LOCAL_FEEDBACK_PORT || 8787);

const readJsonBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
};

const createVercelLikeResponse = (serverResponse) => ({
  status(statusCode) {
    serverResponse.statusCode = statusCode;
    return this;
  },
  json(body) {
    serverResponse.setHeader('Content-Type', 'application/json; charset=utf-8');
    serverResponse.end(JSON.stringify(body));
    return this;
  },
});

const server = createServer(async (request, response) => {
  if (request.url?.split('?')[0] !== '/api/feedback') {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }

  const body = await readJsonBody(request);
  await handler(
    {
      method: request.method,
      headers: request.headers,
      body,
    },
    createVercelLikeResponse(response)
  );
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local feedback API listening on http://127.0.0.1:${port}/api/feedback`);
});
