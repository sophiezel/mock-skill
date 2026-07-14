'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function resolveHandlerFile(mocksRoot, urlPath, hostHeader) {
  const clean = urlPath.replace(/\/+$/, '') || '/';
  const relative = clean.replace(/^\//, '');
  const candidates = [];

  if (hostHeader) {
    const host = hostHeader.split(':')[0];
    candidates.push(path.join(mocksRoot, host, relative, 'index.js'));
    candidates.push(path.join(mocksRoot, host.replace(/\./g, '_'), relative, 'index.js'));
  }
  candidates.push(path.join(mocksRoot, '_default', relative, 'index.js'));
  candidates.push(path.join(mocksRoot, relative, 'index.js'));

  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function clearRequireCache(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
  } catch (_) {
    /* ignore */
  }
}

function createRouter({ mocksRoot, caseHeader }) {
  const router = express.Router();

  const handler = async (req, res) => {
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const filePath = resolveHandlerFile(mocksRoot, req.path, host);

    if (!filePath) {
      res.status(404).json({
        code: 404,
        message: `no mock handler for ${req.method} ${req.path}`,
        data: null,
      });
      return;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (/^\s*{[\s\S]*}\s*$/.test(raw)) {
        res.json(JSON.parse(raw));
        return;
      }
      clearRequireCache(filePath);
      const fn = require(filePath);
      const mockCase =
        req.headers[caseHeader] ||
        req.query.__mockCase ||
        req.query.mockCase;
      const payload = await delay(
        50,
        fn({
          method: req.method,
          query: req.query,
          params: req.params,
          body: req.body,
          headers: req.headers,
          path: req.path,
          caseId: mockCase,
        }),
      );
      res.json(payload);
    } catch (err) {
      res.status(500).json({
        code: 500,
        message: err.message,
        data: null,
      });
    }
  };

  router.all('/*', handler);
  return router;
}

module.exports = createRouter;
