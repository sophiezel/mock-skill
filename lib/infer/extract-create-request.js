'use strict';

/**
 * Canonical createRequest extractor entry for adapters.
 * Implementation currently lives in scripts/infer-api-usage (shared helpers);
 * adapters MUST import from this lib path (not scripts/) to keep the dependency
 * direction adapter → lib.
 */

const {
  extractCreateRequestApis,
  joinPrefix,
  isGatewayOnlyPath,
} = require('../../scripts/infer-api-usage');

module.exports = {
  extractCreateRequestApis,
  joinPrefix,
  isGatewayOnlyPath,
};
