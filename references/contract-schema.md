# Contract schema

```json
{
  "id": "GET api.example.com/v1/list",
  "method": ["GET"],
  "host": "api.example.com",
  "path": "/v1/list",
  "source": "usage|docs|manual|existing_mock",
  "role": "new|modify|dependency|unrelated",
  "relatedToTask": false,
  "confidence": "high|medium|low",
  "lastTaskId": "TR-1234",
  "history": [{ "taskId": "TR-1234", "role": "modify", "at": "...", "action": "update" }],
  "request": { "query": {}, "body": {}, "headers": [] },
  "response": {
    "envelope": { "code": "number", "data": "object|null", "message": "string" },
    "successCode": 0,
    "dataFields": {},
    "bizCodes": []
  },
  "cases": [
    { "id": "success", "response": { "code": 0, "data": {}, "message": "" } }
  ]
}
```
