'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { resolveCase, pickCase, isDescriptor } = require('../../lib/case-resolve');

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

function sendPlan(res, plan) {
  if (plan.fault === 'reset') {
    res.destroy();
    return;
  }
  if (plan.fault === 'hang') {
    // do not write anything; let client timeout
    return;
  }
  const status = plan.httpStatus > 0 ? plan.httpStatus : 200;
  if (plan.body === undefined || plan.body === null) {
    res.status(status).end();
    return;
  }
  res.status(status).json(plan.body);
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
        // static JSON file (legacy)
        res.json(JSON.parse(raw));
        return;
      }
      clearRequireCache(filePath);
      const fn = require(filePath);
      const mockCase =
        req.headers[caseHeader] ||
        req.query.__mockCase ||
        req.query.mockCase;

      const result = await fn({
        method: req.method,
        query: req.query,
        params: req.params,
        body: req.body,
        headers: req.headers,
        path: req.path,
        caseId: mockCase,
      });

      // Legacy: handler returned a plain envelope body. Default 200, no delay/fault.
      // New: handler may return a descriptor { httpStatus, body, delayMs, fault } or a cases map + active caseId.
      let plan;
      if (isDescriptor(result)) {
        plan = resolveCase(mockCase, result);
      } else if (
        result &&
        typeof result === 'object' &&
        !Array.isArray(result) &&
        result.cases &&
        typeof result.cases === 'object'
      ) {
        const entry = pickCase(result.cases, mockCase || result.defaultCase || 'success');
        plan = resolveCase(mockCase || result.defaultCase || 'success', entry);
      } else {
        plan = resolveCase(mockCase, { response: result });
      }

      if (plan.delayMs && plan.delayMs > 0) {
        setTimeout(() => sendPlan(res, plan), plan.delayMs);
      } else {
        sendPlan(res, plan);
      }
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
